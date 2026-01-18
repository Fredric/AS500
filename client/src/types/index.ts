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
  fileDownload?: { // Trigger file download in browser
    filename: string;
    content: string;
    mimeType: string;
  };
}

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
