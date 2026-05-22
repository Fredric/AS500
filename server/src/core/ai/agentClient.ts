// OpenAI-compatible HTTP client pointed at the internal AI Agent server.
//
// AS500 only knows about this file — it never talks to Ollama, vLLM, or MCP
// directly. The agent is the stable abstraction layer.
//
// Configuration (server/.env.local):
//   AI_AGENT_BASE_URL=http://127.0.0.1:8010/v1
//   AI_AGENT_API_KEY=<shared secret — same as AGENT_API_KEY on the agent>
//   AI_AGENT_MODEL=as500-agent

import OpenAI from 'openai';

export interface ChatMetadata {
  userId: string;
  chatId: string;
  tenantId?: string;
  source?: string;
  /** User MCP JWT minted by mintMcpAccessTokenForUser — never logged. */
  mcpAccessToken?: string;
}

export type ChatMessageParam = OpenAI.Chat.ChatCompletionMessageParam;

// ============================================
// Lazy singleton client
// ============================================

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;

  const baseURL = process.env.AI_AGENT_BASE_URL;
  const apiKey = process.env.AI_AGENT_API_KEY;

  if (!baseURL) throw new Error('AI_AGENT_BASE_URL is not set');
  if (!apiKey) throw new Error('AI_AGENT_API_KEY is not set');

  _client = new OpenAI({ baseURL, apiKey });
  return _client;
}

function getModel(): string {
  return process.env.AI_AGENT_MODEL ?? 'as500-agent';
}

// ============================================
// Public API
// ============================================

/** Return model ids available on the agent (used for health checks). */
export async function listModels(): Promise<string[]> {
  const client = getClient();
  const result = await client.models.list();
  return result.data.map((m) => m.id);
}

/**
 * Stream a chat completion from the AI Agent.
 *
 * Yields raw SSE `data:` payload strings (already JSON).
 * The caller forwards these to the browser WebSocket.
 */
export async function* streamChatCompletion(
  messages: ChatMessageParam[],
  metadata: ChatMetadata,
): AsyncGenerator<string> {
  const client = getClient();

  const stream = await client.chat.completions.create({
    model: getModel(),
    messages,
    stream: true,
    // Pass metadata as an extra body field; the agent reads it.
    // @ts-expect-error — metadata is an agent extension, not in OpenAI types
    metadata,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/**
 * Non-streaming chat completion — returns the full answer string.
 * Useful for simple one-shot calls and tests.
 */
export async function chatCompletion(
  messages: ChatMessageParam[],
  metadata: ChatMetadata,
): Promise<string> {
  const client = getClient();

  const result = await client.chat.completions.create({
    model: getModel(),
    messages,
    stream: false,
    // @ts-expect-error — metadata is an agent extension
    metadata,
  });

  return result.choices[0]?.message?.content ?? '';
}
