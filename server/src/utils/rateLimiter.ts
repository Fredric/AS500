/**
 * Simple in-memory rate limiter
 * Tracks requests per identifier (IP, user ID, etc.) and enforces limits
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Cleanup expired entries every minute. `unref()` so the interval
    // doesn't keep the event loop alive during scripts / tests.
    setInterval(() => this.cleanup(), 60000).unref();
  }

  /**
   * Check if a request should be allowed
   * @param identifier - Unique identifier (IP address, user ID, etc.)
   * @returns true if allowed, false if rate limit exceeded
   */
  public check(identifier: string): boolean {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry || now > entry.resetAt) {
      // First request or window expired - allow and reset
      this.requests.set(identifier, {
        count: 1,
        resetAt: now + this.windowMs,
      });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      // Rate limit exceeded
      return false;
    }

    // Increment counter
    entry.count++;
    return true;
  }

  /**
   * Get remaining requests for an identifier
   */
  public getRemaining(identifier: string): number {
    const entry = this.requests.get(identifier);
    if (!entry || Date.now() > entry.resetAt) {
      return this.maxRequests;
    }
    return Math.max(0, this.maxRequests - entry.count);
  }

  /**
   * Reset rate limit for an identifier (useful for testing or manual resets)
   */
  public reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetAt) {
        this.requests.delete(key);
      }
    }
  }
}

const isProduction = process.env.NODE_ENV === 'production';
export const loginRateLimiter = new RateLimiter(isProduction ? 5 : 100, 60 * 1000); // 5 attempts/min in prod, 100 in dev/test
export const tokenRefreshRateLimiter = new RateLimiter(10, 60 * 60 * 1000); // 10 refreshes per hour

// Per-token (or per-IP fallback) limiter for the MCP `POST /mcp` endpoint.
// Much more permissive than the login limiter: agents legitimately batch calls.
// 120 req/min in prod, 600 in dev — a single registered client id is the key
// when a bearer token is present; otherwise falls back to the client IP.
export const mcpCallRateLimiter = new RateLimiter(isProduction ? 120 : 600, 60 * 1000);
