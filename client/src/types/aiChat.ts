export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** True while an assistant message is still streaming in */
  streaming?: boolean;
}

export type AiChatEvent =
  | { type: 'AI_CHAT_DELTA'; delta: string; chatId: string; sessionId: string }
  | { type: 'AI_CHAT_DONE'; chatId: string; sessionId: string }
  | { type: 'AI_CHAT_ERROR'; error: string; chatId?: string; sessionId: string };
