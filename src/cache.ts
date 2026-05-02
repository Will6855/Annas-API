import NodeCache from 'node-cache';
import Redis from 'ioredis';
import { config } from './config';
import { logger } from './logger';
import { ScrapeSearchResponse, SearchFilters } from './types';

// Global stats
let globalHits = 0;
let globalMisses = 0;

interface ICacheEngine {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
  getStats(): Promise<Record<string, any>>;
}

// ─── Memory Engine (NodeCache) ───────────────────────────────────────────────

class MemoryEngine implements ICacheEngine {
  private searchCache = new NodeCache({ stdTTL: config.cache.ttlSearch, checkperiod: 60, useClones: false });
  private bookCache = new NodeCache({ stdTTL: config.cache.ttlBook, checkperiod: 120, useClones: false });
  private relatedCache = new NodeCache({ stdTTL: config.cache.ttlRelated, checkperiod: 120, useClones: false });
  private genericCache = new NodeCache({ checkperiod: 30, useClones: false });

  private getCacheForKey(key: string): NodeCache {
    if (key.startsWith('search:')) return this.searchCache;
    if (key.startsWith('book:')) return this.bookCache;
    if (key.startsWith('related:')) return this.relatedCache;
    return this.genericCache;
  }

  async get<T>(key: string): Promise<T | null> {
    const cache = this.getCacheForKey(key);
    const val = cache.get<T>(key);
    if (val !== undefined) {
      globalHits++;
      return val;
    }
    globalMisses++;
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const cache = this.getCacheForKey(key);
    if (ttl) {
      cache.set(key, value, ttl);
    } else {
      cache.set(key, value);
    }
    logger.debug(`Cache SET [memory] ${key}`);
  }

  async del(key: string): Promise<void> {
    this.getCacheForKey(key).del(key);
  }

  async flush(): Promise<void> {
    this.searchCache.flushAll();
    this.bookCache.flushAll();
    this.relatedCache.flushAll();
    this.genericCache.flushAll();
    globalHits = 0;
    globalMisses = 0;
  }

  async getStats(): Promise<Record<string, any>> {
    const s = this.searchCache.getStats();
    const b = this.bookCache.getStats();
    const r = this.relatedCache.getStats();
    return {
      type: 'memory',
      search: { keys: this.searchCache.keys().length, hits: s.hits, misses: s.misses },
      book: { keys: this.bookCache.keys().length, hits: b.hits, misses: b.misses },
      related: { keys: this.relatedCache.keys().length, hits: r.hits, misses: r.misses },
      totalHits: globalHits,
      totalMisses: globalMisses,
    };
  }
}

// ─── Redis Engine (ioredis) ──────────────────────────────────────────────────

class RedisEngine implements ICacheEngine {
  private redis: Redis;
  private prefix: string;

  constructor() {
    this.prefix = config.redis.prefix;
    this.redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });
    this.redis.on('error', (err) => logger.error('Redis Error', err));
    this.redis.on('connect', () => logger.info('Connected to Redis'));
  }

  private k(key: string) { return `${this.prefix}${key}`; }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(this.k(key));
      if (data) {
        globalHits++;
        return JSON.parse(data);
      }
    } catch (e) {
      logger.error(`Redis GET error for ${key}`, e);
    }
    globalMisses++;
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const k = this.k(key);
      const val = JSON.stringify(value);
      // Determine TTL based on key type if not provided
      let finalTtl = ttl;
      if (!finalTtl) {
        if (key.startsWith('search:')) finalTtl = config.cache.ttlSearch;
        else if (key.startsWith('book:')) finalTtl = config.cache.ttlBook;
        else if (key.startsWith('related:')) finalTtl = config.cache.ttlRelated;
      }

      if (finalTtl) {
        await this.redis.set(k, val, 'EX', finalTtl);
      } else {
        await this.redis.set(k, val);
      }
      logger.debug(`Cache SET [redis] ${k}`);
    } catch (e) {
      logger.error(`Redis SET error for ${key}`, e);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }

  async flush(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    globalHits = 0;
    globalMisses = 0;
  }

  async getStats(): Promise<Record<string, any>> {
    const info = await this.redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(.*)/)?.[1] || 'unknown';
    const keys = await this.redis.keys(`${this.prefix}*`);
    return {
      type: 'redis',
      connected: this.redis.status === 'ready',
      usedMemory,
      totalKeys: keys.length,
      totalHits: globalHits,
      totalMisses: globalMisses,
    };
  }
}

// ─── Exported API ────────────────────────────────────────────────────────────

const engine: ICacheEngine = config.cache.type === 'redis' ? new RedisEngine() : new MemoryEngine();

function buildSearchKey(query: string, page: number, filters: SearchFilters = {}): string {
  const parts = ['search', encodeURIComponent(query.toLowerCase().trim()), `p${page}`];
  const filterStr = Object.keys(filters).sort().filter(k => (filters as any)[k]).map(k => `${k}=${(filters as any)[k]}`).join('&');
  if (filterStr) parts.push(filterStr);
  return parts.join(':');
}

export async function getSearch(query: string, page: number, filters: SearchFilters): Promise<ScrapeSearchResponse | null> {
  return engine.get<ScrapeSearchResponse>(buildSearchKey(query, page, filters));
}

export async function setSearch(query: string, page: number, filters: SearchFilters, data: any): Promise<void> {
  await engine.set(buildSearchKey(query, page, filters), data);
}

export async function getBook(md5: string): Promise<any | null> {
  return engine.get(`book:${md5.toLowerCase().trim()}`);
}

export async function setBook(md5: string, data: any): Promise<void> {
  await engine.set(`book:${md5.toLowerCase().trim()}`, data);
}

export async function getRelated(md5: string): Promise<any | null> {
  return engine.get(`related:${md5.toLowerCase().trim()}`);
}

export async function setRelated(md5: string, data: any): Promise<void> {
  await engine.set(`related:${md5.toLowerCase().trim()}`, data);
}

export async function get<T>(key: string): Promise<T | null> {
  return engine.get<T>(key);
}

export async function set<T>(key: string, value: T, ttl?: number): Promise<void> {
  await engine.set(key, value, ttl);
}

export async function del(key: string): Promise<void> {
  await engine.del(key);
}

export async function flush(): Promise<void> {
  await engine.flush();
}

export async function getStats(): Promise<Record<string, any>> {
  const stats = await engine.getStats();
  const hits = stats.totalHits;
  const misses = stats.totalMisses;
  return {
    ...stats,
    hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : '0%',
  };
}
