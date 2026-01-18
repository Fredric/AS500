// Screen Renderer
// Converts DSL screen definitions into 80x24 character grid
import { BORDERS } from './components/primitives.js';
import { renderHeader } from './components/header.js';
import { renderForm, getFirstFieldName } from './components/form.js';
import { renderSubfile, getFirstSubfileField } from './components/subfile.js';
import { renderMenu } from './components/menu.js';
const WIDTH = 80;
const HEIGHT = 24;
/**
 * Create an empty 80x24 character grid
 */
function createGrid() {
    const grid = [];
    for (let row = 0; row < HEIGHT; row++) {
        grid.push(new Array(WIDTH).fill(' '));
    }
    return grid;
}
/**
 * Write text to the grid at a specific position
 * Handles overflow and out-of-bounds gracefully
 */
function writeToGrid(grid, row, col, content) {
    if (row < 0 || row >= HEIGHT)
        return;
    for (let i = 0; i < content.length; i++) {
        const targetCol = col + i;
        if (targetCol >= 0 && targetCol < WIDTH) {
            grid[row][targetCol] = content[i];
        }
    }
}
/**
 * Convert grid to array of row strings
 */
function gridToRows(grid) {
    return grid.map(row => row.join(''));
}
/**
 * Render a box element to the grid
 */
function renderBox(grid, row, col, width, height, border, title) {
    const chars = BORDERS[border];
    // Top border
    writeToGrid(grid, row, col, chars.topLeft);
    writeToGrid(grid, row, col + 1, chars.horizontal.repeat(width - 2));
    writeToGrid(grid, row, col + width - 1, chars.topRight);
    // Title (if provided, centered in top border)
    if (title) {
        const titleStart = col + Math.floor((width - title.length - 2) / 2);
        writeToGrid(grid, row, titleStart, ` ${title} `);
    }
    // Side borders
    for (let i = 1; i < height - 1; i++) {
        writeToGrid(grid, row + i, col, chars.vertical);
        writeToGrid(grid, row + i, col + width - 1, chars.vertical);
    }
    // Bottom border
    writeToGrid(grid, row + height - 1, col, chars.bottomLeft);
    writeToGrid(grid, row + height - 1, col + 1, chars.horizontal.repeat(width - 2));
    writeToGrid(grid, row + height - 1, col + width - 1, chars.bottomRight);
}
/**
 * Main render function
 * Converts a screen definition + context into a complete screen response
 */
export function render(screen, context = {}, options = {}) {
    const grid = createGrid();
    const fields = [];
    let defaultCursorField = screen.defaultCursor;
    // Process each element
    for (const element of screen.elements) {
        switch (element.kind) {
            case 'text': {
                writeToGrid(grid, element.row, element.col, element.content);
                break;
            }
            case 'box': {
                renderBox(grid, element.row, element.col, element.width, element.height, element.border, element.title);
                break;
            }
            case 'line': {
                const lineContent = element.char.repeat(element.length);
                writeToGrid(grid, element.row, element.col, lineContent);
                break;
            }
            case 'header': {
                const headerResult = renderHeader(element, { user: options.user });
                for (const textRow of headerResult.rows) {
                    writeToGrid(grid, textRow.row, textRow.col, textRow.content);
                }
                break;
            }
            case 'form': {
                const formResult = renderForm(element, context);
                // Write text content
                for (const textRow of formResult.textRows) {
                    writeToGrid(grid, textRow.row, textRow.col, textRow.content);
                }
                // Collect fields
                for (const field of formResult.fields) {
                    fields.push(field);
                }
                // Set default cursor to first form field if not specified
                if (!defaultCursorField) {
                    defaultCursorField = getFirstFieldName(element);
                }
                break;
            }
            case 'subfile': {
                const pageOffset = context[`${element.name}_offset`] || 0;
                const subfileResult = renderSubfile(element, context, pageOffset);
                // Write text content
                for (const textRow of subfileResult.textRows) {
                    writeToGrid(grid, textRow.row, textRow.col, textRow.content);
                }
                // Collect fields
                for (const field of subfileResult.fields) {
                    fields.push(field);
                }
                // Set default cursor to first subfile field if not specified
                if (!defaultCursorField) {
                    defaultCursorField = getFirstSubfileField(element);
                }
                break;
            }
            case 'menu': {
                const menuResult = renderMenu(element);
                // Write text content
                for (const textRow of menuResult.textRows) {
                    writeToGrid(grid, textRow.row, textRow.col, textRow.content);
                }
                // Collect fields
                for (const field of menuResult.fields) {
                    fields.push(field);
                }
                // Set default cursor to selection field
                if (!defaultCursorField) {
                    defaultCursorField = 'selection';
                }
                break;
            }
            case 'window': {
                // Render window as an overlay box
                renderBox(grid, element.row, element.col, element.width, element.height, element.border, element.title);
                break;
            }
        }
    }
    // Write status line (row 22)
    if (screen.statusLine) {
        writeToGrid(grid, 22, 1, screen.statusLine);
    }
    // Write message line (row 23)
    if (options.message) {
        writeToGrid(grid, 23, 1, options.message);
    }
    // Find cursor position
    let cursor = { row: 0, col: 0 };
    if (defaultCursorField) {
        const cursorField = fields.find(f => f.name === defaultCursorField);
        if (cursorField) {
            cursor = { row: cursorField.row, col: cursorField.col };
        }
    }
    else if (fields.length > 0) {
        cursor = { row: fields[0].row, col: fields[0].col };
    }
    return {
        screenId: screen.id,
        rows: gridToRows(grid),
        fields,
        cursor,
        statusLine: screen.statusLine || '',
        message: options.message || null,
        messageType: options.messageType || null,
        bell: options.messageType === 'error',
    };
}
/**
 * Define a screen (type helper for better autocomplete)
 */
export function defineScreen(id, config) {
    return {
        id,
        ...config,
    };
}
