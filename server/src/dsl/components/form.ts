// Form Component
// Aligned label/field layout for data entry screens

import type { FormElement, FormRowDef, FieldDef } from '../types.js';

export interface FormOptions {
  labelCol?: number;  // Column where labels start (default: 10)
  fieldCol?: number;  // Column where fields start (default: 30)
  rowSpacing?: number; // Rows between each form row (default: 1)
}

/**
 * Create a form element with aligned labels and fields
 * 
 * Example:
 * ```
 * form(6, [
 *   ['Customer #:', field('custno', 10, 'numeric')],
 *   ['Name:', field('name', 30, 'alpha')],
 *   ['Address:', field('address', 40, 'alpha')],
 * ], { labelCol: 10, fieldCol: 25 })
 * ```
 * 
 * @param startRow - Row where the form begins
 * @param rows - Array of [label, field] tuples
 * @param options - Column alignment options
 */
export function form(
  startRow: number,
  rows: Array<[string, FieldDef]>,
  options: FormOptions = {}
): FormElement {
  const formRows: FormRowDef[] = rows.map(([label, fieldDef]) => ({
    label,
    field: fieldDef,
  }));

  return {
    kind: 'form',
    startRow,
    labelCol: options.labelCol ?? 10,
    fieldCol: options.fieldCol ?? 30,
    rows: formRows,
  };
}

/**
 * Render form element
 * Returns text content and field definitions with positions
 */
export function renderForm(
  element: FormElement,
  context: Record<string, unknown>
): {
  textRows: Array<{ row: number; col: number; content: string }>;
  fields: Array<{
    row: number;
    col: number;
    length: number;
    type: FieldDef['type'];
    name: string;
    required?: boolean;
    uppercase?: boolean;
  }>;
} {
  const textRows: Array<{ row: number; col: number; content: string }> = [];
  const fields: Array<{
    row: number;
    col: number;
    length: number;
    type: FieldDef['type'];
    name: string;
    required?: boolean;
    uppercase?: boolean;
  }> = [];

  element.rows.forEach((formRow, index) => {
    const row = element.startRow + index;

    // Add label
    textRows.push({
      row,
      col: element.labelCol,
      content: formRow.label,
    });

    // Add field placeholder (underscores or value)
    const fieldValue = context[formRow.field.name];
    let displayValue: string;

    if (formRow.field.type === 'password') {
      // Never show password values, always show underscores
      displayValue = '_'.repeat(formRow.field.length);
    } else if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      // Show the value, padded to field length
      displayValue = String(fieldValue).slice(0, formRow.field.length).padEnd(formRow.field.length, '_');
    } else {
      // Show underscores as placeholder
      displayValue = '_'.repeat(formRow.field.length);
    }

    textRows.push({
      row,
      col: element.fieldCol,
      content: displayValue,
    });

    // Add field definition
    fields.push({
      row,
      col: element.fieldCol,
      length: formRow.field.length,
      type: formRow.field.type,
      name: formRow.field.name,
      required: formRow.field.required,
      uppercase: formRow.field.uppercase,
    });
  });

  return { textRows, fields };
}

/**
 * Get the first field name from a form (for default cursor position)
 */
export function getFirstFieldName(element: FormElement): string | undefined {
  return element.rows[0]?.field.name;
}
