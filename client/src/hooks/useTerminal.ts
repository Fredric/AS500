import { useState, useEffect, useCallback, useRef } from 'react';
import type { ScreenResponse, ClientRequest, Field } from '../types';

const WS_URL = 'ws://localhost:3000';
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
    };

    ws.onmessage = (event) => {
      try {
        const response: ScreenResponse = JSON.parse(event.data);

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
          // Use server-provided field values, or clear on screen change
          fieldValues: response.screenId !== prev.screenId
            ? (response.fieldValues || {})
            : prev.fieldValues,
          responseCount: prev.responseCount + 1, // Trigger focus on every response
        }));
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
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
