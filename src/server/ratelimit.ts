import type { Request, Response, NextFunction } from 'express';

/** Minimal in-memory sliding-window rate limiter keyed by a string (IP, username...). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the call is allowed (and records it). */
  hit(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  /** Drop stale keys. Called occasionally so memory does not grow forever. */
  sweep(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [k, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(k);
      else this.hits.set(k, kept);
    }
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return (first || req.socket.remoteAddress || 'unknown').trim();
}

export function rateLimitMiddleware(limiter: RateLimiter, message: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!limiter.hit(clientIp(req))) {
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
