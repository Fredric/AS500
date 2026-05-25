import { useState, useCallback, useEffect, useRef } from 'react';
import type { AiChatMessage, AiChatEvent } from '../types/aiChat';

interface UseAiChatOptions {
  sessionId: string | null;
  screenId: string;
  connected: boolean;
  registerAiChatHandler: (handler: ((event: AiChatEvent) => void) | null) => void;
  sendRaw: (payload: object) => void;
}

export interface UseAiChatReturn {
  messages: AiChatMessage[];
  streaming: boolean;
  error: string | null;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sendMessage: (text: string) => void;
  clearError: () => void;
}

function getOrCreateChatId(): string {
  const key = 'as500_chat_id';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export function useAiChat({
  sessionId,
  screenId,
  connected,
  registerAiChatHandler,
  sendRaw,
}: UseAiChatOptions): UseAiChatReturn {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const chatIdRef = useRef(getOrCreateChatId());

  // Register/unregister the AI_CHAT_* event handler with useTerminal
  useEffect(() => {
    const handler = (event: AiChatEvent) => {
      if (event.type === 'AI_CHAT_DELTA') {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + event.delta },
            ];
          }
          return [
            ...prev,
            { role: 'assistant', content: event.delta, streaming: true },
          ];
        });
      } else if (event.type === 'AI_CHAT_DONE') {
        setStreaming(false);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false }];
          }
          return prev;
        });
      } else if (event.type === 'AI_CHAT_ERROR') {
        setStreaming(false);
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.streaming) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        setError(event.error);
      }
    };

    registerAiChatHandler(handler);
    return () => registerAiChatHandler(null);
  }, [registerAiChatHandler]);

  const sendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !connected || !sessionId || streaming) return;

    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setStreaming(true);
    setError(null);

    sendRaw({
      sessionId,
      screenId,
      cursor: { row: 0, col: 0 },
      input: { chatId: chatIdRef.current, message: trimmed },
      key: 'AI_CHAT_SEND',
    });
  }, [connected, sessionId, screenId, streaming, sendRaw]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(v => !v), []);
  const clearError = useCallback(() => setError(null), []);

  return { messages, streaming, error, isOpen, open, close, toggle, sendMessage, clearError };
}
