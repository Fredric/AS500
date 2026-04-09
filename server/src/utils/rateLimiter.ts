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

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
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

// Preconfigured rate limiters for common use cases
export const loginRateLimiter = new RateLimiter(5, 60 * 1000); // 5 attempts per minute
export const tokenRefreshRateLimiter = new RateLimiter(10, 60 * 60 * 1000); // 10 refreshes per hour
export const generalRateLimiter = new RateLimiter(100, 60 * 1000); // 100 requests per minute
