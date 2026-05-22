// AS500 AI chat service.
//
// Orchestrates:
//   1. Minting a per-request MCP JWT for the authenticated session user.
//   2. Calling the AI Agent's OpenAI-compatible streaming API.
//   3. Persisting chat history to ai_chats / ai_messages.
//
// Security contract:
//   - Never call this unless session.authenticated === true and
//     session.viserId is set.
//   - The mcpAccessToken is NOT stored in session or returned to the browser.
//   - Only pass the token to the AI Agent over the internal LAN connection
//     protected by AGENT_API_KEY.

import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { aiChats, aiMessages } from '../db/schema.js';
import type { Session } from '../types/index.js';
import { mintMcpAccessTokenForUser } from '../mcp/mintSessionToken.js';
import { streamChatCompletion, type ChatMessageParam } from './agentClient.js';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ============================================
// History helpers
// ============================================

async function ensureChat(chatId: string, userId: number): Promise<void> {
  const existing = await db
    .select({ id: aiChats.id })
    .from(aiChats)
    .where(eq(aiChats.id, chatId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(aiChats).values({ id: chatId, user_id: userId });
  }
}

async function loadHistory(chatId: string): Promise<AiChatMessage[]> {
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.chat_id, chatId))
    .orderBy(aiMessages.created_at);

  return rows.map((r) => ({
    role: r.role as 'user' | 'assistant',
    content: r.content,
  }));
}

async function appendMessage(
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await db.insert(aiMessages).values({ chat_id: chatId, role, content });
}

// ============================================
// Public API
// ============================================

/**
 * Stream a chat turn as an async generator of assistant text chunks.
 *
 * The caller (WebSocket handler) forwards each chunk to the browser as an
 * `AI_CHAT_DELTA` message and collects the full answer to persist it.
 *
 * @param session   Authenticated WS session — must have viserId set.
 * @param chatId    Client-supplied stable chat id (uuid).
 * @param userText  The user's message for this turn.
 */
export async function* streamChatTurn(
  session: Session,
  chatId: string,
  userText: string,
): AsyncGenerator<string> {
  if (!session.authenticated || session.viserId == null || !session.username) {
    throw new Error('streamChatTurn called on unauthenticated session');
  }

  const userId = session.viserId;
  const username = session.username;

  await ensureChat(chatId, userId);

  const history = await loadHistory(chatId);
  await appendMessage(chatId, 'user', userText);

  // Mint a short-lived JWT for this request — not stored anywhere after use.
  const mcpAccessToken = await mintMcpAccessTokenForUser(userId, username);

  const messages: ChatMessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessageParam),
    { role: 'user' as const, content: userText },
  ];

  const metadata = {
    userId: String(userId),
    chatId,
    source: 'as500',
    mcpAccessToken,
  };

  let fullAnswer = '';
  for await (const chunk of streamChatCompletion(messages, metadata)) {
    fullAnswer += chunk;
    yield chunk;
  }

  if (fullAnswer) {
    await appendMessage(chatId, 'assistant', fullAnswer);
  }
}

/**
 * Load the message history for a chat session.
 * Used to rebuild conversation context when the client reconnects.
 */
export async function getChatHistory(chatId: string): Promise<AiChatMessage[]> {
  return loadHistory(chatId);
}
