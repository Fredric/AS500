// Menu Component
// Numbered list of options for menu screens

import type { MenuElement, MenuItemDef, FieldDef } from '../types.js';

/**
 * Create a menu element with numbered options
 * 
 * Example:
 * ```
 * menu(8, 12, [
 *   { option: 1, label: 'Customer maintenance' },
 *   { option: 2, label: 'Order entry' },
 *   { option: 3, label: 'Inventory management' },
 * ], { selectionRow: 16, selectionCol: 20 })
 * ```
 * 
 * @param startRow - Row where the menu items begin
 * @param col - Column where menu items start
 * @param items - Menu item definitions
 * @param selection - Position for the selection input field
 */
export function menu(
  startRow: number,
  col: number,
  items: MenuItemDef[],
  selection: { row: number; col: number; length?: number }
): MenuElement {
  return {
    kind: 'menu',
    startRow,
    col,
    items,
    selectionRow: selection.row,
    selectionCol: selection.col,
    selectionLength: selection.length ?? 1,
  };
}

/**
 * Render menu element
 * Returns menu text rows and selection field definition
 */
export function renderMenu(
  element: MenuElement
): {
  textRows: Array<{ row: number; col: number; content: string }>;
  fields: Array<{
    row: number;
    col: number;
    length: number;
    type: FieldDef['type'];
    name: string;
    required: boolean;
  }>;
} {
  const textRows: Array<{ row: number; col: number; content: string }> = [];
  const fields: Array<{
    row: number;
    col: number;
    length: number;
    type: FieldDef['type'];
    name: string;
    required: boolean;
  }> = [];

  // Render menu items
  element.items.forEach((item, index) => {
    const row = element.startRow + index;
    const content = `${item.option}. ${item.label}`;
    
    textRows.push({
      row,
      col: element.col,
      content,
    });
  });

  // Add selection prompt
  textRows.push({
    row: element.selectionRow,
    col: element.col,
    content: 'Selection: ' + '_'.repeat(element.selectionLength),
  });

  // Add selection field
  fields.push({
    row: element.selectionRow,
    col: element.selectionCol,
    length: element.selectionLength,
    type: 'numeric',
    name: 'selection',
    required: true,
  });

  return { textRows, fields };
}
