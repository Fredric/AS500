import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
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
    navigation,
    screenId,
    setFieldValue,
    setCursor,
    sendKey,
    sendKeyWithInput,
  } = useTerminal();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Responsive scaling: fit terminal to window while preserving aspect ratio
  const [fontSize, setFontSize] = useState(16);
  const naturalDimsRef = useRef<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const PADDING = 32; // gap kept on each side of the terminal
    const BASE_FONT_SIZE = 16;

    const computeScale = () => {
      const el = containerRef.current;
      if (!el) return;

      // Capture natural (unscaled) dimensions exactly once, at base font-size
      if (!naturalDimsRef.current) {
        naturalDimsRef.current = { width: el.offsetWidth, height: el.offsetHeight };
      }

      const { width: natW, height: natH } = naturalDimsRef.current;
      const availW = window.innerWidth - PADDING * 2;
      const availH = window.innerHeight - PADDING * 2;
      const scale = Math.min(availW / natW, availH / natH);
      setFontSize(Math.max(8, BASE_FONT_SIZE * scale));
    };

    computeScale();
    window.addEventListener('resize', computeScale);
    return () => window.removeEventListener('resize', computeScale);
  }, []);

  // Row focus state for list navigation
  const [focusedDataRowIndex, setFocusedDataRowIndex] = useState<number | null>(null);
  const prevNavKeyRef = useRef<string | null>(null);
  const focusLastOnNextPageRef = useRef(false);

  // Reset row focus when entering a new list screen page or different screen
  useEffect(() => {
    const navKey = navigation?.list
      ? `${screenId}:${navigation.list.pageOffset}`
      : null;

    if (navKey !== prevNavKeyRef.current) {
      prevNavKeyRef.current = navKey;
      if (navigation?.list) {
        if (focusLastOnNextPageRef.current) {
          focusLastOnNextPageRef.current = false;
          setFocusedDataRowIndex(navigation.list.dataRowCount - 1);
        } else {
          setFocusedDataRowIndex(0);
        }
      } else {
        setFocusedDataRowIndex(null);
      }
    }
  }, [navigation, screenId]);

  const isListMode = !!navigation?.list;

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

  // Trigger a row action by filling the opt field and sending ENTER
  const triggerRowAction = useCallback((rowIndex: number, option: string) => {
    if (!navigation?.list) return;
    const { optFieldPrefix } = navigation.list;
    sendKeyWithInput('ENTER', { [`${optFieldPrefix}_${rowIndex}`]: option });
  }, [navigation, sendKeyWithInput]);

  // Handle keyboard events on the container
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const list = navigation?.list;

    // --- List mode navigation ---
    if (isListMode && list) {
      // Arrow down: move focus down or advance page
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedDataRowIndex(prev => {
          const cur = prev ?? 0;
          if (cur < list.dataRowCount - 1) {
            return cur + 1;
          } else if (list.hasMore) {
            sendKey('PAGEDOWN');
            return 0; // will be reset by effect on page change
          }
          return cur;
        });
        return;
      }

      // Arrow up: move focus up or go to previous page
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedDataRowIndex(prev => {
          const cur = prev ?? 0;
          if (cur > 0) {
            return cur - 1;
          } else if (list.hasPrev) {
            focusLastOnNextPageRef.current = true;
            sendKey('PAGEUP');
            return 0; // will be reset by effect on page change
          }
          return cur;
        });
        return;
      }

      // Enter: trigger primary action on focused row
      if (e.key === 'Enter' && focusedDataRowIndex !== null && list.primaryAction) {
        e.preventDefault();
        triggerRowAction(focusedDataRowIndex, list.primaryAction);
        return;
      }

      // Tab / Shift+Tab: move row focus
      if (e.key === 'Tab') {
        e.preventDefault();
        setFocusedDataRowIndex(prev => {
          const cur = prev ?? 0;
          if (e.shiftKey) {
            return Math.max(0, cur - 1);
          } else {
            return Math.min(list.dataRowCount - 1, cur + 1);
          }
        });
        return;
      }

      // Single-letter shortcut keys (e.g. 'd' for delete)
      if (focusedDataRowIndex !== null && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const shortcut = list.shortcuts.find(s => s.key.toLowerCase() === e.key.toLowerCase());
        if (shortcut) {
          e.preventDefault();
          triggerRowAction(focusedDataRowIndex, shortcut.option);
          return;
        }
      }

      // F6 and other F-keys pass through normally (create, etc.)
    } else {
      // --- Normal mode: Tab navigation between fields ---
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
    }

    // Special keys - send to server
    if (SPECIAL_KEYS[e.key]) {
      e.preventDefault();
      sendKey(SPECIAL_KEYS[e.key]);
      return;
    }
  }, [cursor, navigation, isListMode, focusedDataRowIndex, getNextField, getPrevField, focusField, sendKey, triggerRowAction]);

  // Handle keyboard events on input fields
  // In list mode, input fields still use normal field behavior (user can type opt codes directly).
  // Row navigation (arrow keys, Enter shortcuts) only activates when the container has focus.
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab navigation (works in all modes)
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (isListMode && navigation?.list) {
        // Tab moves between data rows
        const { dataRowCount } = navigation.list;
        setFocusedDataRowIndex(prev => {
          const cur = prev ?? 0;
          return e.shiftKey ? Math.max(0, cur - 1) : Math.min(dataRowCount - 1, cur + 1);
        });
        containerRef.current?.focus();
      } else {
        const nextField = e.shiftKey
          ? getPrevField(cursor.row, cursor.col)
          : getNextField(cursor.row, cursor.col);
        if (nextField) {
          focusField(nextField);
        }
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
  }, [cursor, navigation, isListMode, getNextField, getPrevField, focusField, sendKey]);

  // Focus management after every server response
  useEffect(() => {
    if (isListMode) {
      // In list navigation mode, focus the container so arrow keys work
      containerRef.current?.focus();
    } else if (fields.length > 0) {
      const targetField = fields.find(
        f => f.row === cursor.row && f.col === cursor.col
      ) || fields[0];
      setTimeout(() => focusField(targetField), 50);
    } else {
      containerRef.current?.focus();
    }
  }, [responseCount, focusField, isListMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render a row with field inputs overlaid
  const renderRow = (row: string, rowIndex: number) => {
    const rowFields = fields.filter(f => f.row === rowIndex);

    // Compute list row states
    const listNav = navigation?.list;
    const relativeRowIndex = listNav
      ? rowIndex - listNav.dataStartRow
      : -1;
    const isSelectableRow = listNav !== undefined
      && relativeRowIndex >= 0
      && relativeRowIndex < listNav.dataRowCount;
    const isFocusedRow = isSelectableRow && relativeRowIndex === focusedDataRowIndex;

    const rowClasses = [
      'terminal-row',
      isSelectableRow ? 'terminal-row--selectable' : '',
      isFocusedRow ? 'terminal-row--focused' : '',
    ].filter(Boolean).join(' ');

    const rowClickProps = isSelectableRow ? {
      onClick: () => {
        setFocusedDataRowIndex(relativeRowIndex);
        containerRef.current?.focus();
      },
      onDoubleClick: () => {
        setFocusedDataRowIndex(relativeRowIndex);
        if (listNav?.primaryAction) {
          triggerRowAction(relativeRowIndex, listNav.primaryAction);
        }
      },
    } : {};

    if (rowFields.length === 0) {
      return (
        <div key={rowIndex} className={rowClasses} {...rowClickProps}>
          <span className="terminal-text">{row}</span>
        </div>
      );
    }

    // Build segments with fields
    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

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

      const positionKey = `${field.row},${field.col}`;
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

            if (field.uppercase) {
              newValue = newValue.toUpperCase();
            }

            if (field.type === 'numeric') {
              newValue = newValue.replace(/[^0-9.-]/g, '');
            }

            setFieldValue(field.name, newValue);
          }}
          onKeyDown={handleInputKeyDown}
          onFocus={() => {
            setCursor(field.row, field.col);
            if (isSelectableRow) {
              setFocusedDataRowIndex(relativeRowIndex);
            }
          }}
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
      <div key={rowIndex} className={rowClasses} {...rowClickProps}>
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
      style={{ fontSize: `${fontSize}px` }}
    >
      {/* Connection status */}
      <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
        {connected ? '● Connected' : '○ Disconnected'}
      </div>

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
