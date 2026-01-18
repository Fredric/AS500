// Session state
export interface Session {
  id: string;
  viserId: number | null;
  username: string | null;
  authenticated: boolean;
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
  fileUpload?: { // File uploaded from browser
    filename: string;
    content: string;
  };
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
  fileDownload?: { // Trigger file download in browser
    filename: string;
    content: string;
    mimeType: string;
  };
}

// Database user
export interface User {
  id: number;
  username: string;
  password_hash: string;
  full_name: string | null;
  active: number;
  created_at: string;
}

// Screen handler function type
export type ScreenHandler = (
  session: Session,
  request: ClientRequest
) => ScreenResponse;
