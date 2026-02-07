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

// Cookie helpers
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days: number = 1) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict`;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
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

  // Connect to WebSocket
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    hasResumedRef.current = false;

    // Heartbeat interval to keep session alive (every 60 seconds)
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));

      const storedSession = storedSessionRef.current;

      if (storedSession && !hasResumedRef.current) {
        // Try to resume existing session
        hasResumedRef.current = true;
        const resumeRequest: ClientRequest = {
          sessionId: storedSession,
          screenId: '',
          cursor: { row: 0, col: 0 },
          input: {},
          key: 'RESUME',
        };
        ws.send(JSON.stringify(resumeRequest));
      } else {
        // No stored session - request initial screen
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
      }, 60000); // Send heartbeat every 60 seconds
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle PONG response (heartbeat acknowledgment)
        if (data.type === 'PONG') {
          // Heartbeat acknowledged, no action needed
          return;
        }

        const response: ScreenResponse = data;

        // Play bell if requested
        if (response.bell) {
          playBell();
        }

        // Save session to cookie
        if (response.sessionId) {
          setCookie(SESSION_COOKIE_NAME, response.sessionId);
          storedSessionRef.current = response.sessionId;
        }

        // Clear cookie on sign-off (returning to LOGIN after being authenticated)
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
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      ws.close();
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
