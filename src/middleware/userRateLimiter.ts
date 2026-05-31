import { Response, NextFunction } from 'express';
import { AppDataSource } from '../db';
import { User } from '../entities/User';
import { AuthRequest } from './auth';

interface RateLimitEntry {
  timestamps: number[];
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

// Window size: 1 minute
const WINDOW_MS = 60_000;

function getWindowStart(): number {
  return Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
}

function pruneEntries(entries: RateLimitEntry): void {
  const cutoff = Date.now() - WINDOW_MS;
  entries.timestamps = entries.timestamps.filter(t => t > cutoff);
}

/**
 * Creates a per-user rate limiter for a specific endpoint type.
 * Reads the user's rate limit from the database.
 * A value of -1 means "unlimited" (no rate limit at all — for admins).
 * A value of 0 means "block all requests".
 */
export function createUserRateLimiter(endpointType: 'search' | 'book') {
  const isSearch = endpointType === 'search';

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    // Determine which specific endpoint this request maps to
    const path = req.path;
    let field: string;
    let typeLabel: string;
    
    if (isSearch) {
      field = 'rateLimitSearch';
      typeLabel = 'search';
    } else if (path.endsWith('/download')) {
      field = 'rateLimitBookDownload';
      typeLabel = 'bookDownload';
    } else if (path.endsWith('/related')) {
      field = 'rateLimitBookRelated';
      typeLabel = 'bookRelated';
    } else {
      // Default: book detail (/:md5)
      field = 'rateLimitBookDetail';
      typeLabel = 'bookDetail';
    }

    try {
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: req.user.id },
        select: { id: true, [field]: true } as any,
      });

      if (!user) {
        return next();
      }

      const limit = user[field as keyof typeof user] as number;

      // Get or create store for this user + endpoint (always track for progress)
      const userId = req.user.id;
      if (!stores.has(userId)) {
        stores.set(userId, new Map());
      }
      const userStore = stores.get(userId)!;

      const now = Date.now();
      const windowStart = getWindowStart();
      const windowKey = `${typeLabel}:${windowStart}`;

      if (!userStore.has(windowKey)) {
        userStore.set(windowKey, { timestamps: [] });
      }

      const entry = userStore.get(windowKey)!;
      pruneEntries(entry);

      entry.timestamps.push(now);

      // Track usage for progress
      (req as any)._rateLimitKey = windowKey;
      (req as any)._rateLimitUsed = entry.timestamps.length;
      (req as any)._rateLimitMax = limit;

      // -1 means unlimited — track progress but don't block
      if (limit === -1) {
        return next();
      }

      // 0 means blocked entirely
      if (limit === 0) {
        return res.status(429).json({
          success: false,
          error: `You have been rate-limited for the /api/${typeLabel} endpoint. Contact an admin.`,
        });
      }

      if (entry.timestamps.length >= limit) {
        return res.status(429).json({
          success: false,
          error: `Rate limit exceeded for /api/${typeLabel}. Maximum ${limit} requests per minute.`,
        });
      }

      next();
    } catch (error) {
      // If DB fails, let the request through rather than blocking
      next();
    }
  };
}

/**
 * Clean up old entries every 5 minutes
 */
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [userId, userStore] of stores.entries()) {
    for (const [key, entry] of userStore.entries()) {
      entry.timestamps = entry.timestamps.filter(t => t > cutoff);
      if (entry.timestamps.length === 0) {
        userStore.delete(key);
      }
    }
    if (userStore.size === 0) {
      stores.delete(userId);
    }
  }
}, 300_000);

/**
 * Get the current rate limit usage for a user (number of requests in the current window).
 */
export function getUserRateLimitProgress(userId: string): { bookDetail: number; bookDownload: number; bookRelated: number; search: number } {
  const userStore = stores.get(userId);
  if (!userStore) {
    return { bookDetail: 0, bookDownload: 0, bookRelated: 0, search: 0 };
  }

  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const types = ['bookDetail', 'bookDownload', 'bookRelated', 'search'] as const;
  const result: any = {};
  for (const t of types) {
    const key = `${t}:${windowStart}`;
    result[t] = userStore.get(key)?.timestamps.length ?? 0;
  }
  return result as { bookDetail: number; bookDownload: number; bookRelated: number; search: number };

}
