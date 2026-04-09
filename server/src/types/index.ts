// Session state
export interface Session {
  id: string;
  viserId: number | null;
  username: string | null;
  authenticated: boolean;
  isAdmin: boolean;
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
  is_admin: boolean;
  created_at: Date;
}

// Screen handler function type
export type ScreenHandler = (
  session: Session,
  request: ClientRequest
) => ScreenResponse;
