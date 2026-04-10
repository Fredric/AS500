import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScreenResponse, ClientRequest, Field } from '../types';

// Dynamic WebSocket URL: use secure wss:// in production, ws:// in development
function getWebSocketUrl(): string {
  if (import.meta.env.PROD) {
    // Production: connect to same host using secure WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }
  // Development: connect to local server
  return 'ws://localhost:3001';
}

const WS_URL = getWebSocketUrl();
const SESSION_COOKIE_NAME = 'as500_session';
const ACCESS_TOKEN_COOKIE_NAME = 'as500_access_token';
const REFRESH_TOKEN_COOKIE_NAME = 'as500_refresh_token';
const DEVICE_ID_COOKIE_NAME = 'as500_device_id';
// Cookie helpers with proper security flags
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, hours?: number) {
  const isSecure = window.location.protocol === 'https:';
  const expires = new Date(Date.now() + (hours ?? 24) * 3600 * 1000).toUTCString();
  // Note: HttpOnly cannot be set from JavaScript (server-side only)
  // but we set SameSite=Strict and Secure for HTTPS
  const secureFlag = isSecure ? '; Secure' : '';
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict${secureFlag}`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Strict`;
}

function getDeviceId(): string {
  let deviceId = getCookie(DEVICE_ID_COOKIE_NAME);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    setCookie(DEVICE_ID_COOKIE_NAME, deviceId, 365 * 24); // 1 year
  }
  return deviceId;
}

interface TerminalState {
  connected: boolean;
  sessionId: string | null;
  screenId: string;
  rows: string[];
  fields: Field[];
  cursor: { row: number; col: number };
  message: string | null;
  messageType: 'info' | 'warning' | 'error' | null;
  statusLine: string;
  fieldValues: Record<string, string>;
  responseCount: number; // Increments on each server response for focus tracking
}

export function useTerminal() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000); // ms, doubles on each failure up to 30s
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<TerminalState>({
    connected: false,
    sessionId: getCookie(SESSION_COOKIE_NAME), // Load from cookie on init
    screenId: '',
    rows: Array(24).fill(' '.repeat(80)),
    fields: [],
    cursor: { row: 0, col: 0 },
    message: null,
    messageType: null,
    statusLine: '',
    fieldValues: {},
    responseCount: 0,
  });

  // Track if we've sent resume request
  const hasResumedRef = useRef(false);
  const storedSessionRef = useRef(getCookie(SESSION_COOKIE_NAME));
  const storedAccessTokenRef = useRef(getCookie(ACCESS_TOKEN_COOKIE_NAME));
  const storedRefreshTokenRef = useRef(getCookie(REFRESH_TOKEN_COOKIE_NAME));
  const deviceIdRef = useRef(getDeviceId());

  // Connect to WebSocket (called on mount and after every disconnect)
  useEffect(() => {
    let destroyed = false;

    function connect() {
      if (destroyed) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      hasResumedRef.current = false;

      // Heartbeat interval to keep session alive (every 60 seconds)
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }

        // Successful connection — reset backoff
        reconnectDelayRef.current = 1000;
        setState(prev => ({ ...prev, connected: true }));

        const storedSession = storedSessionRef.current;
        const storedAccessToken = storedAccessTokenRef.current;
        const storedRefreshToken = storedRefreshTokenRef.current;
        const deviceId = deviceIdRef.current;

        if ((storedSession || storedAccessToken || storedRefreshToken) && !hasResumedRef.current) {
          // Try to resume existing session with tokens
          hasResumedRef.current = true;
          const resumeRequest: ClientRequest = {
            sessionId: storedSession,
            screenId: '',
            cursor: { row: 0, col: 0 },
            input: {},
            key: 'RESUME',
            accessToken: storedAccessToken ?? undefined,
            refreshToken: storedRefreshToken ?? undefined,
            deviceId,
          };
          ws.send(JSON.stringify(resumeRequest));
        } else {
          // No stored session or tokens - request initial screen
          const initRequest: ClientRequest = {
            sessionId: null,
            screenId: '',
            cursor: { row: 0, col: 0 },
            input: {},
            key: 'CONNECT',
          };
          ws.send(JSON.stringify(initRequest));
        }

        // Start heartbeat to keep session alive
        heartbeatInterval = setInterval(() => {
          const currentSessionId = storedSessionRef.current;
          if (ws.readyState === WebSocket.OPEN && currentSessionId) {
            const pingRequest: ClientRequest = {
              sessionId: currentSessionId,
              screenId: '',
              cursor: { row: 0, col: 0 },
              input: {},
              key: 'PING',
            };
            ws.send(JSON.stringify(pingRequest));
          }
        }, 60000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'PONG') {
            return;
          }

          const response: ScreenResponse = data;

          // Play bell if requested
          if (response.bell) {
            playBell();
          }

          // Save session to cookie (7 days so it survives typical usage between sessions)
          if (response.sessionId) {
            setCookie(SESSION_COOKIE_NAME, response.sessionId, 7 * 24);
            storedSessionRef.current = response.sessionId;
          }

          if (response.accessToken !== undefined) {
            if (response.accessToken === null) {
              deleteCookie(ACCESS_TOKEN_COOKIE_NAME);
              storedAccessTokenRef.current = null;
            } else {
              const expiryHours = response.accessExpiresAt
                ? Math.max(0.1, (new Date(response.accessExpiresAt).getTime() - Date.now()) / 3600000)
                : 1;
              setCookie(ACCESS_TOKEN_COOKIE_NAME, response.accessToken, expiryHours);
              storedAccessTokenRef.current = response.accessToken;
            }
          }

          if (response.refreshToken !== undefined) {
            if (response.refreshToken === null) {
              deleteCookie(REFRESH_TOKEN_COOKIE_NAME);
              storedRefreshTokenRef.current = null;
            } else {
              const expiryHours = response.refreshExpiresAt
                ? Math.max(0.1, (new Date(response.refreshExpiresAt).getTime() - Date.now()) / 3600000)
                : 30 * 24;
              setCookie(REFRESH_TOKEN_COOKIE_NAME, response.refreshToken, expiryHours);
              storedRefreshTokenRef.current = response.refreshToken;
            }
          }

          // Clear session cookie on sign-off (returning to LOGIN after being authenticated)
          if (response.screenId === 'LOGIN' && state.screenId !== 'LOGIN' && state.screenId !== '') {
            deleteCookie(SESSION_COOKIE_NAME);
            storedSessionRef.current = null;
          }

          setState(prev => ({
            ...prev,
            sessionId: response.sessionId,
            screenId: response.screenId,
            rows: response.rows,
            fields: response.fields,
            cursor: response.cursor,
            message: response.message,
            messageType: response.messageType,
            statusLine: response.statusLine,
            // Use server-provided field values if explicitly provided, otherwise preserve on same screen
            fieldValues: response.fieldValues !== undefined
              ? response.fieldValues
              : (response.screenId !== prev.screenId ? {} : prev.fieldValues),
            responseCount: prev.responseCount + 1, // Trigger focus on every response
          }));
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }));
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }

        // Schedule reconnect with exponential backoff (1s → 2s → 4s → … → 30s)
        if (!destroyed) {
          const delay = reconnectDelayRef.current;
          reconnectDelayRef.current = Math.min(delay * 2, 30000);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      wsRef.current?.close();
    };
  }, []);

  // Play bell sound
  const playBell = useCallback(() => {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  }, []);

  // Update field value by name
  const setFieldValue = useCallback((fieldName: string, value: string) => {
    setState(prev => ({
      ...prev,
      fieldValues: {
        ...prev.fieldValues,
        [fieldName]: value,
      },
    }));
  }, []);

  // Update cursor position
  const setCursor = useCallback((row: number, col: number) => {
    setState(prev => ({
      ...prev,
      cursor: { row, col },
    }));
  }, []);

  // Send key to server
  const sendKey = useCallback((key: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const request: ClientRequest = {
      sessionId: state.sessionId,
      screenId: state.screenId,
      cursor: state.cursor,
      input: state.fieldValues,
      key,
      deviceId: deviceIdRef.current,
    };

    wsRef.current.send(JSON.stringify(request));
  }, [state.sessionId, state.screenId, state.cursor, state.fieldValues]);

  return {
    ...state,
    setFieldValue,
    setCursor,
    sendKey,
  };
}
