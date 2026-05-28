import { useRef, useEffect, useState, useCallback } from 'react';
import type { UseAiChatReturn } from '../hooks/useAiChat';
import MarkdownMessage from './MarkdownMessage';
import ManualSourcePanel from './ManualSourcePanel';
import '../styles/ai-chat.css';

interface AiChatPanelProps {
  chat: UseAiChatReturn;
  authenticated: boolean;
}

export default function AiChatPanel({ chat, authenticated }: AiChatPanelProps) {
  const { messages, streaming, error, isOpen, close, sendMessage, clearError } = chat;

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Restore focus after streaming ends — the browser blurs disabled inputs,
  // so we need to re-focus the textarea once the AI finishes responding.
  useEffect(() => {
    if (!streaming && isOpen) {
      inputRef.current?.focus();
    }
  }, [streaming, isOpen]);

  const handleSubmit = useCallback(() => {
    if (!inputText.trim() || streaming || !authenticated) return;
    sendMessage(inputText);
    setInputText('');
  }, [inputText, streaming, authenticated, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Prevent Esc from bubbling to terminal (Terminal.tsx maps Esc → F3)
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }, [handleSubmit, close]);

  if (!isOpen) return null;

  return (
    <div className="ai-chat-panel" role="dialog" aria-label="AI Assistant" onKeyDown={e => e.stopPropagation()}>
      <div className="ai-chat-header">
        <span className="ai-chat-title">&#x25A0; AS500 AI ASSISTANT</span>
        <button className="ai-chat-close" onClick={close} aria-label="Close">&#x2715;</button>
      </div>

      <div className="ai-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-chat-empty">
            Ask me anything about your AS500 data.{'\n'}
            <span className="ai-chat-hint">e.g. "List my time registrations for today"</span>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-chat-msg ai-chat-msg--${msg.role}`}>
            <span className="ai-chat-msg-label">
              {msg.role === 'user' ? 'YOU' : 'AI '}
            </span>
            <span className="ai-chat-msg-content">
              {msg.role === 'assistant' ? (
                <>
                  <MarkdownMessage content={msg.content} streaming={msg.streaming} />
                  {!msg.streaming && msg.sources && msg.sources.length > 0 && (
                    <ManualSourcePanel sources={msg.sources} />
                  )}
                </>
              ) : (
                <>{msg.content}{msg.streaming && <span className="ai-chat-cursor">&#x258C;</span>}</>
              )}
            </span>
          </div>
        ))}
        {error && (
          <div className="ai-chat-error">
            <span>ERROR: {error}</span>
            <button className="ai-chat-error-dismiss" onClick={clearError}>&#x2715;</button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-row">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={authenticated ? 'Type a message… (Enter to send, Shift+Enter for newline)' : 'Sign in to use AI chat'}
          disabled={!authenticated || streaming}
          rows={2}
          aria-label="Chat input"
        />
        <button
          className="ai-chat-send"
          onClick={handleSubmit}
          disabled={!authenticated || streaming || !inputText.trim()}
          aria-label="Send"
        >
          {streaming ? '...' : 'SEND'}
        </button>
      </div>
    </div>
  );
}
