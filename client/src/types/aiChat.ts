export interface DocsImageRef {
  image_id: string;
  page_number: number | null;
  caption: string | null;
}

export interface DocsSource {
  manual_id: string;
  manual_title: string;
  manufacturer: string;
  model: string;
  year: number | null;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  images: DocsImageRef[];
}

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** True while an assistant message is still streaming in */
  streaming?: boolean;
  /** Source references from the workshop manual (assistant messages only) */
  sources?: DocsSource[];
}

export type AiChatEvent =
  | { type: 'AI_CHAT_DELTA'; delta: string; chatId: string; sessionId: string }
  | { type: 'AI_CHAT_DONE'; chatId: string; sessionId: string }
  | { type: 'AI_CHAT_ERROR'; error: string; chatId?: string; sessionId: string }
  | { type: 'AI_CHAT_SOURCES'; sources: DocsSource[]; chatId: string; sessionId: string };
