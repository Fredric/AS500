import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import type { Field } from '../types';

// Special keys to intercept
const SPECIAL_KEYS: Record<string, string> = {
  'Enter': 'ENTER',
  'Escape': 'F3',
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
  const naturalDimsRef = useRef<{ width: number; height: number; baseFontSize: number } | null>(null);

  useLayoutEffect(() => {
    const PADDING = 32; // gap kept on each side of the terminal
    let cancelled = false;
    let rafId: number | null = null;

    const computeScale = () => {
      const el = containerRef.current;
      // Don't measure until natural dims are known (i.e. after fonts load)
      if (!el || !naturalDimsRef.current) return;

      const { width: natW, height: natH, baseFontSize } = naturalDimsRef.current;
      const availW = window.innerWidth - PADDING * 2;
      const availH = window.innerHeight - PADDING * 2;
      const scale = Math.min(availW / natW, availH / natH);
      setFontSize(Math.max(8, baseFontSize * scale));
    };

    // Throttle resize via requestAnimationFrame to avoid excessive layout reads
    // during interactive window resizing.
    const handleResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeScale();
      });
    };

    // Wait for the webfont (IBM Plex Mono) to finish loading before capturing
    // natural dimensions, so measurements are based on actual glyph metrics
    // rather than fallback font metrics. Base font-size is also read from
    // getComputedStyle so it stays in sync with the CSS definition.
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const el = containerRef.current;
      if (!el) return;
      const baseFontSize = parseFloat(getComputedStyle(el).fontSize);
      naturalDimsRef.current = { width: el.offsetWidth, height: el.offsetHeight, baseFontSize };
      computeScale();
    });

    window.addEventListener('resize', handleResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, []);

  // Row focus state for list navigation
  const [focusedDataRowIndex, setFocusedDataRowIndex] = useState<number | null>(null);
  const prevNavKeyRef = useRef<string | null>(null);
  const focusLastOnNextPageRef = useRef(false);

  // Reset row/menu focus when entering a new screen or page
  useEffect(() => {
    const navKey = navigation?.list
      ? `${screenId}:${navigation.list.pageOffset}`
      : navigation?.menu
      ? `${screenId}:menu`
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
      } else if (navigation?.menu) {
        setFocusedDataRowIndex(0);
      } else {
        setFocusedDataRowIndex(null);
      }
    }
  }, [navigation, screenId]);

  const isListMode = !!navigation?.list;
  const isMenuMode = !!navigation?.menu;

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
    const menuNav = navigation?.menu;

    // --- Menu mode navigation ---
    if (isMenuMode && menuNav) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedDataRowIndex(prev => Math.min((prev ?? 0) + 1, menuNav.items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedDataRowIndex(prev => Math.max((prev ?? 0) - 1, 0));
        return;
      }
      if (e.key === 'Enter' && focusedDataRowIndex !== null) {
        e.preventDefault();
        const item = menuNav.items[focusedDataRowIndex];
        if (item) {
          sendKeyWithInput('ENTER', { [menuNav.selectionField]: item.value });
        }
        return;
      }
    }

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

      // Arrow left/right: send F7/F8 for screen-level prev/next (e.g. day navigation)
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        sendKey('F7');
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        sendKey('F8');
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
        // 'n' → create new record (server handles as F6)
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          sendKey('F6');
          return;
        }
      }
    } else if (!isMenuMode) {
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
  }, [cursor, navigation, isListMode, isMenuMode, focusedDataRowIndex, getNextField, getPrevField, focusField, sendKey, sendKeyWithInput, triggerRowAction]);

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
    if (isListMode || isMenuMode) {
      // In list/menu navigation mode, focus the container so arrow keys work
      containerRef.current?.focus();
    } else if (fields.length > 0) {
      const targetField = fields.find(
        f => f.row === cursor.row && f.col === cursor.col
      ) || fields[0];
      setTimeout(() => focusField(targetField), 50);
    } else {
      containerRef.current?.focus();
    }
  }, [responseCount, focusField, isListMode, isMenuMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render a row with field inputs overlaid
  const renderRow = (row: string, rowIndex: number) => {
    const rowFields = fields.filter(f => f.row === rowIndex);

    // Compute list row states
    const listNav = navigation?.list;
    const menuNav = navigation?.menu;
    const relativeRowIndex = listNav
      ? rowIndex - listNav.dataStartRow
      : -1;
    const isSelectableRow = listNav !== undefined
      && relativeRowIndex >= 0
      && relativeRowIndex < listNav.dataRowCount;
    const isFocusedListRow = isSelectableRow && relativeRowIndex === focusedDataRowIndex;
    const isFocusedMenuRow = menuNav !== undefined
      && focusedDataRowIndex !== null
      && menuNav.items[focusedDataRowIndex]?.row === rowIndex;
    const isFocusedRow = isFocusedListRow || isFocusedMenuRow;

    const rowClasses = [
      'terminal-row',
      isSelectableRow ? 'terminal-row--selectable' : '',
      isFocusedRow ? 'terminal-row--focused' : '',
    ].filter(Boolean).join(' ');

    if (rowFields.length === 0) {
      return (
        <div key={rowIndex} className={rowClasses}>
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
      <div key={rowIndex} className={rowClasses}>
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
