// Screen DSL Type Definitions

export const SCREEN_WIDTH = 80;
export const SCREEN_HEIGHT = 24;

// Field types matching the existing protocol
export type FieldType = 'alpha' | 'numeric' | 'date' | 'password' | 'readonly';

// Border styles for boxes
export type BorderStyle = 'single' | 'double' | 'none';

// Field definition within DSL
export interface FieldDef {
  kind: 'field';
  name: string;
  length: number;
  type: FieldType;
  required?: boolean;
  uppercase?: boolean;
  prompt?: string; // F4 prompt screen
  defaultValue?: string;
}

// Text element - static text at a position
export interface TextElement {
  kind: 'text';
  row: number;
  col: number;
  content: string;
}

// Box element - bordered rectangle
export interface BoxElement {
  kind: 'box';
  row: number;
  col: number;
  width: number;
  height: number;
  border: BorderStyle;
  title?: string;
}

// Horizontal line
export interface LineElement {
  kind: 'line';
  row: number;
  col: number;
  length: number;
  char: string;
}

// Form row - label + field pair
export interface FormRowDef {
  label: string;
  field: FieldDef;
}

// Form element - aligned label/field rows
export interface FormElement {
  kind: 'form';
  startRow: number;
  labelCol: number;
  fieldCol: number;
  rows: FormRowDef[];
}

// Header element - standard screen header
export interface HeaderElement {
  kind: 'header';
  system?: string;
  title?: string;
  showDateTime?: boolean;
  showUser?: boolean;
}

// Subfile column definition
export interface SubfileColumnDef {
  header: string;
  key?: string;      // Data key for display columns
  field?: string;    // Field name for input columns (like 'opt')
  width: number;
  type?: FieldType;
  align?: 'left' | 'right' | 'center';
}

// Subfile element - scrollable list
export interface SubfileElement {
  kind: 'subfile';
  name: string;
  startRow: number;
  pageSize: number;
  columns: SubfileColumnDef[];
  showMore?: boolean; // Show "More..." indicator
}

// Menu item for menu screens
export interface MenuItemDef {
  option: number | string;
  label: string;
  screen?: string;
}

// Menu element - numbered list of options
export interface MenuElement {
  kind: 'menu';
  startRow: number;
  col: number;
  items: MenuItemDef[];
  selectionRow: number;
  selectionCol: number;
  selectionLength: number;
}

// Window element - overlay popup
export interface WindowElement {
  kind: 'window';
  row: number;
  col: number;
  width: number;
  height: number;
  title?: string;
  border: BorderStyle;
}

// Union of all element types
export type ScreenElement =
  | TextElement
  | BoxElement
  | LineElement
  | FormElement
  | HeaderElement
  | SubfileElement
  | MenuElement
  | WindowElement;

// Complete screen definition
export interface ScreenDef {
  id: string;
  elements: ScreenElement[];
  statusLine?: string;
  defaultCursor?: string; // Field name for initial cursor
}

// Render context - data passed to render()
export interface RenderContext {
  // Dynamic data values
  [key: string]: unknown;
}

// Render options
export interface RenderOptions {
  message?: string | null;
  messageType?: 'info' | 'warning' | 'error' | null;
  user?: string;
}

// Rendered field (matches existing Field type)
export interface FieldOption {
  value: string;
  display: string;
}

export interface RenderedField {
  row: number;
  col: number;
  length: number;
  type: FieldType;
  name: string;
  required?: boolean;
  uppercase?: boolean;
  options?: FieldOption[];
}

// Render result - ready for the protocol
export interface RenderResult {
  screenId: string;
  rows: string[];
  fields: RenderedField[];
  cursor: { row: number; col: number };
  statusLine: string;
  message: string | null;
  messageType: 'info' | 'warning' | 'error' | null;
  bell: boolean;
}
