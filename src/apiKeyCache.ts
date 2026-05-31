/**
 * Simple in-memory cache for API key → user lookups.
 * 60-second TTL to avoid a DB hit on every request.
 */

interface CachedUser {
  id: string;
  username: string;
  role: string;
}

interface CacheEntry {
  user: CachedUser;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const TTL_MS = 60_000;

export function getCachedUser(keyHash: string): CachedUser | undefined {
  const entry = cache.get(keyHash);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(keyHash);
    return undefined;
  }
  return entry.user;
}

export function setCachedUser(keyHash: string, user: CachedUser): void {
  cache.set(keyHash, { user, expiresAt: Date.now() + TTL_MS });
}

export function invalidateCachedKey(keyHash: string): void {
  cache.delete(keyHash);
}

/**
 * Remove all expired entries from the cache (called periodically).
 */
export function pruneCache(): void {
  const now = Date.now();
  for (const [keyHash, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(keyHash);
    }
  }
}

// Prune expired entries every 5 minutes
setInterval(pruneCache, 300_000);
