// Primitive DSL Components
// Building blocks for screen definitions

import type {
  TextElement,
  BoxElement,
  LineElement,
  FieldDef,
  FieldType,
  BorderStyle,
  SCREEN_WIDTH,
} from '../types.js';

// ============================================
// Field Definition
// ============================================

export interface FieldOptions {
  required?: boolean;
  uppercase?: boolean;
  prompt?: string;
  defaultValue?: string;
}

/**
 * Create a field definition
 * @param name - Field identifier (used for data binding and input retrieval)
 * @param length - Maximum input length
 * @param type - Field type (default: 'alpha')
 * @param options - Additional field options
 */
export function field(
  name: string,
  length: number,
  type: FieldType = 'alpha',
  options: FieldOptions = {}
): FieldDef {
  return {
    kind: 'field',
    name,
    length,
    type,
    required: options.required,
    uppercase: options.uppercase,
    prompt: options.prompt,
    defaultValue: options.defaultValue,
  };
}

// ============================================
// Text Element
// ============================================

/**
 * Create a text element at a specific position
 * @param row - Row position (0-23)
 * @param col - Column position (0-79)
 * @param content - Text content to display
 */
export function text(row: number, col: number, content: string): TextElement {
  return {
    kind: 'text',
    row,
    col,
    content,
  };
}

/**
 * Create centered text on a row
 * @param row - Row position (0-23)
 * @param content - Text content to center
 * @param width - Width to center within (default: 80)
 */
export function centeredText(row: number, content: string, width: number = 80): TextElement {
  const col = Math.floor((width - content.length) / 2);
  return {
    kind: 'text',
    row,
    col: Math.max(0, col),
    content,
  };
}

// ============================================
// Box Element
// ============================================

export interface BoxOptions {
  border?: BorderStyle;
  title?: string;
}

/**
 * Create a bordered box
 * @param row - Top row position
 * @param col - Left column position
 * @param width - Box width (including borders)
 * @param height - Box height (including borders)
 * @param options - Border style and title
 */
export function box(
  row: number,
  col: number,
  width: number,
  height: number,
  options: BoxOptions = {}
): BoxElement {
  return {
    kind: 'box',
    row,
    col,
    width,
    height,
    border: options.border ?? 'single',
    title: options.title,
  };
}

// ============================================
// Line Element
// ============================================

/**
 * Create a horizontal line
 * @param row - Row position
 * @param col - Starting column
 * @param length - Line length
 * @param char - Character to use (default: '─')
 */
export function line(row: number, col: number, length: number, char: string = '─'): LineElement {
  return {
    kind: 'line',
    row,
    col,
    length,
    char,
  };
}

/**
 * Create a full-width horizontal line
 * @param row - Row position
 * @param char - Character to use (default: '═')
 */
export function fullLine(row: number, char: string = '═'): LineElement {
  return {
    kind: 'line',
    row,
    col: 0,
    length: 80,
    char,
  };
}

// ============================================
// Helper Functions (not elements, used for content generation)
// ============================================

/**
 * Center a string within a given width
 * @param content - Text to center
 * @param width - Width to center within
 */
export function center(content: string, width: number = 80): string {
  const padding = Math.floor((width - content.length) / 2);
  return ' '.repeat(Math.max(0, padding)) + content;
}

/**
 * Right-align a string within a given width
 * @param content - Text to align
 * @param width - Width to align within
 */
export function rightAlign(content: string, width: number = 80): string {
  const padding = width - content.length;
  return ' '.repeat(Math.max(0, padding)) + content;
}

/**
 * Pad a string to a specific length
 * @param content - Text to pad
 * @param length - Target length
 * @param char - Padding character (default: space)
 */
export function pad(content: string, length: number, char: string = ' '): string {
  return content.padEnd(length, char);
}

/**
 * Create underscores for field placeholder
 * @param length - Number of underscores
 */
export function fieldPlaceholder(length: number): string {
  return '_'.repeat(length);
}

// ============================================
// Box Border Characters
// ============================================

export const BORDERS = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  none: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: ' ',
    vertical: ' ',
  },
} as const;
