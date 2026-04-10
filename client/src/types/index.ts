export interface ListNavigation {
  dataStartRow: number;
  dataRowCount: number;
  totalRecords: number;
  pageOffset: number;
  hasMore: boolean;
  hasPrev: boolean;
  optFieldPrefix: string;
  primaryAction: string;
  shortcuts: Array<{ key: string; option: string; label: string }>;
}

export interface ScreenNavigation {
  type: 'list' | 'form' | 'menu';
  list?: ListNavigation;
}

export interface Field {
  row: number;
  col: number;
  length: number;
  type: 'alpha' | 'numeric' | 'date' | 'password' | 'readonly';
  name: string;
  required?: boolean;
  uppercase?: boolean;
}

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
