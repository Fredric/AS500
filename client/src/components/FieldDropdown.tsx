import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import type { FieldOption } from '../types';

export interface DropdownHandle {
  moveHighlight: (delta: number) => void;
  selectHighlighted: () => void;
  hasItems: () => boolean;
}

interface FieldDropdownProps {
  options: FieldOption[];
  currentValue: string;
  filterText: string;
  anchorRect: DOMRect;
  onSelect: (value: string) => void;
}

const MAX_VISIBLE = 6;

const FieldDropdown = forwardRef<DropdownHandle, FieldDropdownProps>(
  function FieldDropdown({ options, currentValue, filterText, anchorRect, onSelect }, ref) {
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // Filter options by what user typed after opening the dropdown
    const filtered = filterText
      ? options.filter(o => o.display.toUpperCase().includes(filterText.toUpperCase()))
      : options;

    // Highlight current value on mount, reset on filter change
    useEffect(() => {
      if (filterText) {
        setHighlightedIndex(0);
      } else {
        const exactIndex = filtered.findIndex(
          o => o.value.toUpperCase() === currentValue.toUpperCase()
        );
        setHighlightedIndex(exactIndex >= 0 ? exactIndex : 0);
      }
    }, [filterText, currentValue, filtered]);

    // Scroll highlighted item into view
    useEffect(() => {
      const list = listRef.current;
      if (!list) return;
      const item = list.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }, [highlightedIndex]);

    useImperativeHandle(ref, () => ({
      moveHighlight(delta: number) {
        setHighlightedIndex(prev => {
          const next = prev + delta;
          if (next < 0) return 0;
          if (next >= filtered.length) return filtered.length - 1;
          return next;
        });
      },
      selectHighlighted() {
        const item = filtered[highlightedIndex];
        if (item) onSelect(item.value);
      },
      hasItems() {
        return filtered.length > 0;
      },
    }), [filtered, highlightedIndex, onSelect]);

    if (filtered.length === 0) return null;

    // Position: below the field, or above if near bottom of viewport
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const itemHeightPx = anchorRect.height || 22;
    const dropdownHeight = Math.min(filtered.length, MAX_VISIBLE) * itemHeightPx + 4;
    const showAbove = spaceBelow < dropdownHeight + 8 && anchorRect.top > dropdownHeight;

    const style: React.CSSProperties = {
      position: 'fixed',
      left: anchorRect.left,
      minWidth: anchorRect.width,
      zIndex: 100,
      ...(showAbove
        ? { bottom: window.innerHeight - anchorRect.top + 2 }
        : { top: anchorRect.bottom + 2 }),
    };

    return createPortal(
      <div
        className="field-dropdown"
        style={style}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div
          className="field-dropdown__list"
          ref={listRef}
          style={{ maxHeight: `${MAX_VISIBLE * 1.4}em` }}
        >
          {filtered.map((option, i) => (
            <div
              key={option.value}
              className={`field-dropdown__item${i === highlightedIndex ? ' field-dropdown__item--highlighted' : ''}`}
              onMouseEnter={() => setHighlightedIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(option.value);
              }}
            >
              {option.display}
            </div>
          ))}
        </div>
      </div>,
      document.body
    );
  }
);

export default FieldDropdown;
