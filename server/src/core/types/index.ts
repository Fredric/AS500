// Session state
export interface Session {
  id: string;
  viserId: number | null;
  username: string | null;
  authenticated: boolean;
  isAdmin: boolean;
  userRole: 'user' | 'superuser' | 'aiagent' | 'admin' | null;
  permissions: Set<string> | null; // null = not yet loaded; reloaded from DB on resume
  currentScreen: string;
  screenStack: string[];
  context: Record<string, unknown>;
  lastActivity: Date;
}

// Client request
export interface ClientRequest {
  sessionId: string | null;
  screenId: string;
  cursor: { row: number; col: number };
  input: Record<string, string>;
  key: string;
  accessToken?: string; // Short-lived access token (1 hour)
  refreshToken?: string; // Long-lived refresh token (30 days)
  deviceId?: string; // Unique device identifier
}

// Field definition
export interface Field {
  row: number;
  col: number;
  length: number;
  type: 'alpha' | 'numeric' | 'date' | 'password' | 'readonly';
  name: string;
  required?: boolean;
  uppercase?: boolean;
}

// Navigation metadata for list screens
export interface ListNavigation {
  dataStartRow: number;    // Row index in rows[] where data rows begin
  dataRowCount: number;    // Number of visible data rows on this page
  totalRecords: number;
  pageOffset: number;
  hasMore: boolean;
  hasPrev: boolean;
  optFieldPrefix: string;  // e.g. 'opt' → fields named opt_0, opt_1, ...
  primaryAction: string;   // Option value for Enter (e.g. '2', '9', '')
  shortcuts: Array<{ key: string; option: string; label: string }>;
}

export interface MenuNavigation {
  items: Array<{
    row: number;
    value: string;
  }>;
  selectionField: string;
}

// Action in a form's status bar — a tab stop the user can navigate to with Tab/Enter
export interface FormAction {
  key: string;    // Key sent to server when activated  e.g. 'F3', 'M', 'S'
  label: string;  // Display text  e.g. 'Esc=Back', 'M=Mods', 'S=Services'
}

export interface FormNavigation {
  actions: FormAction[];
}

export interface ScreenNavigation {
  type: 'list' | 'form' | 'menu';
  list?: ListNavigation;
  menu?: MenuNavigation;
  form?: FormNavigation;
}

// Server response
export interface ScreenResponse {
  sessionId: string;
  screenId: string;
  cursor: { row: number; col: number };
  rows: string[];
  fields: Field[];
  fieldValues?: Record<string, string>; // Pre-populated values for edit mode
  message: string | null;
  messageType: 'info' | 'warning' | 'error' | null;
  statusLine: string;
  bell: boolean;
  navigation?: ScreenNavigation;
  accessToken?: string | null; // Short-lived access token; null signals client to clear
  refreshToken?: string | null; // Long-lived refresh token; null signals client to clear
  accessExpiresAt?: string; // ISO timestamp for access token expiry
  refreshExpiresAt?: string; // ISO timestamp for refresh token expiry
}

// Database user
export interface User {
  id: number;
  username: string;
  password_hash: string;
  full_name: string | null;
  active: boolean;
  role: 'user' | 'superuser' | 'aiagent' | 'admin';
  created_at: Date;
}

// Screen handler function type
export type ScreenHandler = (
  session: Session,
  request: ClientRequest
) => ScreenResponse;

// ============================================
// Menu node types (used by menus/ and crudtable/)
// ============================================

interface BaseNode {
  key: string;
  name: string;
  requirePermission?: string;
}

export interface MenuNode extends BaseNode {
  type: 'menu';
  title?: string;
  items: AppNode[];
}

export interface CrudNode extends BaseNode {
  type: 'crudtable';
  configId: string;
  initContext?: (session: Session) => void | Promise<void>;
}

export interface ActionNode extends BaseNode {
  type: 'action';
  action: 'log_off';
}

export type AppNode = MenuNode | CrudNode | ActionNode;
