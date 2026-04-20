// MCP tool error shaping.
//
// Every tool handler returns a CallToolResult, and every failure — expected or
// otherwise — needs to surface as a *structured* tool error rather than a
// thrown exception so agents can reason about what happened and retry
// intelligently. This module centralizes that mapping so every handler fails
// the same way.
//
// Error codes are stable strings agents may key on. Keep them short, lower
// snake_case, and additive — never rename once published.

/** Stable error codes returned to the agent in the structured payload. */
export type McpErrorCode =
  | 'validation_failed'
  | 'permission_denied'
  | 'not_found'
  | 'rate_limited'
  | 'unsupported_operation'
  | 'internal_error';

export interface ValidationFieldError {
  name: string;
  message: string;
}

/**
 * Typed error that tool handlers can throw to short-circuit execution with a
 * structured failure. The `toolResultFromError` helper maps it to the MCP
 * CallToolResult shape. Any other `Error` coming out of a handler is mapped to
 * `internal_error` with the message stripped in production.
 */
export class McpToolError extends Error {
  readonly code: McpErrorCode;
  readonly fields?: ValidationFieldError[];

  constructor(code: McpErrorCode, message: string, fields?: ValidationFieldError[]) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.fields = fields;
  }
}

/** Shape agents see in `structuredContent` for every failure. */
export interface McpToolErrorPayload {
  error: {
    code: McpErrorCode;
    message: string;
    fields?: ValidationFieldError[];
  };
}

export interface McpToolResultContent {
  type: 'text';
  text: string;
}

export interface McpCallToolResult {
  content: McpToolResultContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Build a successful CallToolResult. */
export function toolResultOk(
  summary: string,
  structured?: Record<string, unknown>
): McpCallToolResult {
  return {
    content: [{ type: 'text', text: summary }],
    ...(structured !== undefined ? { structuredContent: structured } : {}),
  };
}

/** Build an error CallToolResult from an McpToolError. */
export function toolResultFromError(err: McpToolError): McpCallToolResult {
  const payload: McpToolErrorPayload = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    },
  };
  return {
    content: [{ type: 'text', text: `[${err.code}] ${err.message}` }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError: true,
  };
}

/**
 * Map an arbitrary thrown value to a CallToolResult. Only {@link McpToolError}
 * passes its message through verbatim; everything else is coerced to
 * `internal_error` with a redacted message in production (to avoid leaking
 * stack traces / DB errors to external agents).
 */
export function toolResultFromThrown(
  err: unknown,
  { debug }: { debug: boolean } = { debug: false }
): McpCallToolResult {
  if (err instanceof McpToolError) {
    return toolResultFromError(err);
  }
  const raw = err instanceof Error ? err.message : String(err);
  const message = debug ? raw : 'Internal server error';
  return toolResultFromError(new McpToolError('internal_error', message));
}
