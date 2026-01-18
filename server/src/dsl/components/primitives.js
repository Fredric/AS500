// Primitive DSL Components
// Building blocks for screen definitions
/**
 * Create a field definition
 * @param name - Field identifier (used for data binding and input retrieval)
 * @param length - Maximum input length
 * @param type - Field type (default: 'alpha')
 * @param options - Additional field options
 */
export function field(name, length, type = 'alpha', options = {}) {
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
export function text(row, col, content) {
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
export function centeredText(row, content, width = 80) {
    const col = Math.floor((width - content.length) / 2);
    return {
        kind: 'text',
        row,
        col: Math.max(0, col),
        content,
    };
}
/**
 * Create a bordered box
 * @param row - Top row position
 * @param col - Left column position
 * @param width - Box width (including borders)
 * @param height - Box height (including borders)
 * @param options - Border style and title
 */
export function box(row, col, width, height, options = {}) {
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
export function line(row, col, length, char = '─') {
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
export function fullLine(row, char = '═') {
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
export function center(content, width = 80) {
    const padding = Math.floor((width - content.length) / 2);
    return ' '.repeat(Math.max(0, padding)) + content;
}
/**
 * Right-align a string within a given width
 * @param content - Text to align
 * @param width - Width to align within
 */
export function rightAlign(content, width = 80) {
    const padding = width - content.length;
    return ' '.repeat(Math.max(0, padding)) + content;
}
/**
 * Pad a string to a specific length
 * @param content - Text to pad
 * @param length - Target length
 * @param char - Padding character (default: space)
 */
export function pad(content, length, char = ' ') {
    return content.padEnd(length, char);
}
/**
 * Create underscores for field placeholder
 * @param length - Number of underscores
 */
export function fieldPlaceholder(length) {
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
};
