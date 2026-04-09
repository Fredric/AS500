import { useEffect, useRef, useCallback } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import type { Field } from '../types';

// Special keys to intercept
const SPECIAL_KEYS: Record<string, string> = {
  'Enter': 'ENTER',
  'F1': 'F1',
  'F2': 'F2',
  'F3': 'F3',
  'F4': 'F4',
  'F5': 'F5',
  'F6': 'F6',
  'F7': 'F7',
  'F8': 'F8',
  'F9': 'F9',
  'F10': 'F10',
  'F11': 'F11',
  'F12': 'F12',
  'PageUp': 'PAGEUP',
  'PageDown': 'PAGEDOWN',
};

export default function Terminal() {
  const {
    connected,
    rows,
    fields,
    cursor,
    message,
    messageType,
    statusLine,
    fieldValues,
    responseCount,
    setFieldValue,
    setCursor,
    sendKey,
  } = useTerminal();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Find field at position
  const getFieldAt = useCallback((row: number, col: number): Field | null => {
    return fields.find(f => 
      f.row === row && col >= f.col && col < f.col + f.length
    ) || null;
  }, [fields]);

  // Find next field
  const getNextField = useCallback((currentRow: number, currentCol: number): Field | null => {
    const currentField = getFieldAt(currentRow, currentCol);
    const sortedFields = [...fields].sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    if (!currentField) {
      return sortedFields[0] || null;
    }

    const currentIndex = sortedFields.findIndex(
      f => f.row === currentField.row && f.col === currentField.col
    );

    return sortedFields[(currentIndex + 1) % sortedFields.length] || null;
  }, [fields, getFieldAt]);

  // Find previous field
  const getPrevField = useCallback((currentRow: number, currentCol: number): Field | null => {
    const currentField = getFieldAt(currentRow, currentCol);
    const sortedFields = [...fields].sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    if (!currentField) {
      return sortedFields[sortedFields.length - 1] || null;
    }

    const currentIndex = sortedFields.findIndex(
      f => f.row === currentField.row && f.col === currentField.col
    );

    const prevIndex = currentIndex === 0 ? sortedFields.length - 1 : currentIndex - 1;
    return sortedFields[prevIndex] || null;
  }, [fields, getFieldAt]);

  // Focus field input
  const focusField = useCallback((field: Field) => {
    const key = `${field.row},${field.col}`;
    const input = inputRefs.current.get(key);
    if (input) {
      input.focus();
      setCursor(field.row, field.col);
    }
  }, [setCursor]);

  // Handle keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Tab navigation
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextField = e.shiftKey
        ? getPrevField(cursor.row, cursor.col)
        : getNextField(cursor.row, cursor.col);
      if (nextField) {
        focusField(nextField);
      }
      return;
    }

    // Special keys - send to server
    if (SPECIAL_KEYS[e.key]) {
      e.preventDefault();
      sendKey(SPECIAL_KEYS[e.key]);
      return;
    }
  }, [cursor, getNextField, getPrevField, focusField, sendKey]);

  // Handle keyboard events on input fields
  // Stops propagation to prevent the container's handleKeyDown from also firing
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab navigation
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const nextField = e.shiftKey
        ? getPrevField(cursor.row, cursor.col)
        : getNextField(cursor.row, cursor.col);
      if (nextField) {
        focusField(nextField);
      }
      return;
    }

    // Special keys - send to server
    if (SPECIAL_KEYS[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      sendKey(SPECIAL_KEYS[e.key]);
      return;
    }
  }, [cursor, getNextField, getPrevField, focusField, sendKey]);

  // Focus field after every server response
  useEffect(() => {
    if (fields.length > 0) {
      const targetField = fields.find(
        f => f.row === cursor.row && f.col === cursor.col
      ) || fields[0];
      
      setTimeout(() => focusField(targetField), 50);
    } else {
      // No fields - focus the container so keyboard events still work
      containerRef.current?.focus();
    }
  }, [responseCount, focusField]); // Trigger on every server response

  // Render a row with field inputs overlaid
  const renderRow = (row: string, rowIndex: number) => {
    const rowFields = fields.filter(f => f.row === rowIndex);
    
    if (rowFields.length === 0) {
      // No fields - just render text
      return (
        <div key={rowIndex} className="terminal-row">
          <span className="terminal-text">{row}</span>
        </div>
      );
    }

    // Build segments with fields
    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

    // Sort fields by column
    const sortedFields = [...rowFields].sort((a, b) => a.col - b.col);

    sortedFields.forEach((field) => {
      // Text before field
      if (field.col > lastEnd) {
        segments.push(
          <span key={`text-${lastEnd}`} className="terminal-text">
            {row.substring(lastEnd, field.col)}
          </span>
        );
      }

      // Field input - keyed by field name for server communication
      const positionKey = `${field.row},${field.col}`; // For DOM ref mapping
      const value = fieldValues[field.name] || '';

      segments.push(
        <input 
          key={positionKey}
          ref={(el) => {
            if (el) {
              inputRefs.current.set(positionKey, el);
            }
          }}
          type={field.type === 'password' ? 'password' : 'text'}
          data-1p-ignore
          className={`terminal-field ${field.type}`}
          data-field={field.name}
          style={{ width: `${field.length}ch` }}
          maxLength={field.length}
          value={value}
          onChange={(e) => {
            let newValue = e.target.value;

            // Handle uppercase
            if (field.uppercase) {
              newValue = newValue.toUpperCase();
            }

            // Handle numeric
            if (field.type === 'numeric') {
              newValue = newValue.replace(/[^0-9.-]/g, '');
            }

            setFieldValue(field.name, newValue);
          }}
          onKeyDown={handleInputKeyDown}
          onFocus={() => setCursor(field.row, field.col)}
          disabled={field.type === 'readonly'}
        />
      );

      lastEnd = field.col + field.length;
    });

    // Text after last field
    if (lastEnd < row.length) {
      segments.push(
        <span key={`text-${lastEnd}`} className="terminal-text">
          {row.substring(lastEnd)}
        </span>
      );
    }

    return (
      <div key={rowIndex} className="terminal-row">
        {segments}
      </div>
    );
  };

  return (
    <div 
      className="terminal-container"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Connection status */}
      <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
        {connected ? '● Connected' : '○ Disconnected'}
      </div>

      {/* Version info */}
      <div className="version-info">
        v{__APP_VERSION__} · {__BUILD_DATE__}
      </div>

      {/* Main screen area */}
      <div className="terminal-screen">
        {rows.slice(0, 22).map((row, i) => renderRow(row, i))}
      </div>

      {/* Status line */}
      <div className="terminal-status">
        {statusLine || rows[22] || ''}
      </div>

      {/* Message line */}
      <div className={`terminal-message ${messageType || ''}`}>
        {message || rows[23] || ''}
      </div>
    </div>
  );
}
