import { useRef, useEffect, useState, useCallback } from 'react';
import type { UseAiChatReturn } from '../hooks/useAiChat';
import MarkdownMessage from './MarkdownMessage';
import ManualSourcePanel from './ManualSourcePanel';
import '../styles/ai-chat.css';

interface AiChatPanelProps {
  chat: UseAiChatReturn;
  authenticated: boolean;
}

const MIN_W = 340;
const MIN_H = 320;
const DEFAULT_W = 620;
const DEFAULT_H = Math.min(640, Math.round(window.innerHeight * 0.72));

/** Resize handle directions — 8-point */
type ResizeDir = 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
const RESIZE_DIRS: ResizeDir[] = ['n','ne','e','se','s','sw','w','nw'];

export default function AiChatPanel({ chat, authenticated }: AiChatPanelProps) {
  const { messages, streaming, error, isOpen, close, sendMessage, clearError } = chat;

  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Floating position & size ──────────────────────────────────────────────
  const [pos, setPos] = useState(() => ({
    x: window.innerWidth  - DEFAULT_W - 24,
    y: window.innerHeight - DEFAULT_H - 24,
  }));
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });

  // Drag state (ref so pointer-event handlers don't stale-close over state)
  const drag = useRef<{
    type: 'move' | 'resize';
    dir?: ResizeDir;
    startX: number; startY: number;
    startPosX: number; startPosY: number;
    startW: number; startH: number;
  } | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.type === 'move') {
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - size.w, d.startPosX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - size.h, d.startPosY + dy)),
      });
      return;
    }

    // Resize
    let { startPosX: nx, startPosY: ny, startW: nw, startH: nh } = d;
    const dir = d.dir!;

    if (dir.includes('e')) nw = Math.max(MIN_W, d.startW + dx);
    if (dir.includes('s')) nh = Math.max(MIN_H, d.startH + dy);
    if (dir.includes('w')) { nw = Math.max(MIN_W, d.startW - dx); nx = d.startPosX + d.startW - nw; }
    if (dir.includes('n')) { nh = Math.max(MIN_H, d.startH - dy); ny = d.startPosY + d.startH - nh; }

    setSize({ w: nw, h: nh });
    setPos({ x: nx, y: ny });
  }, [size.w, size.h]);

  const onPointerUp = useCallback(() => { drag.current = null; }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  // Header drag-to-move
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      type: 'move',
      startX: e.clientX, startY: e.clientY,
      startPosX: pos.x, startPosY: pos.y,
      startW: size.w, startH: size.h,
    };
  }, [pos, size]);

  // Edge/corner resize
  const onResizePointerDown = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      type: 'resize', dir,
      startX: e.clientX, startY: e.clientY,
      startPosX: pos.x, startPosY: pos.y,
      startW: size.w, startH: size.h,
    };
  }, [pos, size]);

  // ── Scroll & focus ────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [isOpen]);

  useEffect(() => {
    if (!streaming && isOpen) inputRef.current?.focus();
  }, [streaming, isOpen]);

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!inputText.trim() || streaming || !authenticated) return;
    sendMessage(inputText);
    setInputText('');
  }, [inputText, streaming, authenticated, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }, [handleSubmit, close]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="ai-chat-panel"
      role="dialog"
      aria-label="AI Assistant"
      onKeyDown={e => e.stopPropagation()}
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
    >
      {/* Resize handles */}
      {RESIZE_DIRS.map(dir => (
        <div
          key={dir}
          className={`ai-chat-resize ai-chat-resize--${dir}`}
          onPointerDown={onResizePointerDown(dir)}
        />
      ))}

      {/* Header — drag to move */}
      <div
        className="ai-chat-header"
        onPointerDown={onHeaderPointerDown}
        style={{ cursor: 'grab' }}
      >
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
            <span className="ai-chat-msg-label">{msg.role === 'user' ? 'YOU' : 'AI '}</span>
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
