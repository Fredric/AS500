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
  message: string | null;
  messageType: 'info' | 'warning' | 'error' | null;
  statusLine: string;
  bell: boolean;
}

export interface ClientRequest {
  sessionId: string | null;
  screenId: string;
  cursor: { row: number; col: number };
  input: Record<string, string>;
  key: string;
}
