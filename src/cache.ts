import NodeCache from 'node-cache';
import { config } from './config';
import { logger } from './logger';
import { ScrapeSearchResponse, SearchFilters } from './types';

// Separate caches with different TTLs for optimal memory management
const searchCache = new NodeCache({ stdTTL: config.cache.ttlSearch, checkperiod: 60, useClones: false });
const bookCache = new NodeCache({ stdTTL: config.cache.ttlBook, checkperiod: 120, useClones: false });
const relatedCache = new NodeCache({ stdTTL: config.cache.ttlRelated, checkperiod: 120, useClones: false });

let hits = 0;
let misses = 0;

/**
 * Build a normalized cache key for search requests
 */
function buildSearchKey(query: string, page: number, filters: SearchFilters = {}): string {
  const parts = [
    'search',
    encodeURIComponent(query.toLowerCase().trim()),
    `p${page}`,
  ];
  // Append sorted filter keys so order doesn't matter
  const filterStr = Object.keys(filters)
    .sort()
    .filter(k => (filters as any)[k])
    .map(k => `${k}=${(filters as any)[k]}`)
    .join('&');
  if (filterStr) parts.push(filterStr);
  return parts.join(':');
}

/**
 * Build a normalized cache key for a book by MD5
 */
function buildBookKey(md5: string): string {
  return `book:${md5.toLowerCase().trim()}`;
}

// ─── Search cache ────────────────────────────────────────────────────────────

export function getSearch(query: string, page: number, filters: SearchFilters): ScrapeSearchResponse | null {
  const key = buildSearchKey(query, page, filters);
  const data = searchCache.get<ScrapeSearchResponse>(key);
  if (data !== undefined) { hits++; return data; }
  misses++;
  return null;
}

export function setSearch(query: string, page: number, filters: SearchFilters, data: any): void {
  const key = buildSearchKey(query, page, filters);
  searchCache.set(key, data);
  logger.debug(`Cache SET [search] ${key}`);
}

// ─── Book cache ───────────────────────────────────────────────────────────────

export function getBook(md5: string): any | null {
  const key = buildBookKey(md5);
  const data = bookCache.get<any>(key);
  if (data !== undefined) { hits++; return data; }
  misses++;
  return null;
}

export function setBook(md5: string, data: any): void {
  const key = buildBookKey(md5);
  bookCache.set(key, data);
  logger.debug(`Cache SET [book] ${key}`);
}

// ─── Related books cache ─────────────────────────────────────────────────────

export function getRelated(md5: string): any | null {
  const key = `related:${md5.toLowerCase().trim()}`;
  const data = relatedCache.get<any>(key);
  if (data !== undefined) { hits++; return data; }
  misses++;
  return null;
}

export function setRelated(md5: string, data: any): void {
  const key = `related:${md5.toLowerCase().trim()}`;
  relatedCache.set(key, data);
  logger.debug(`Cache SET [related] ${key}`);
}

// ─── Generic TTL-aware get/set (for domain health etc.) ───────────────────────

const genericCache = new NodeCache({ checkperiod: 30, useClones: false });

export function get<T>(key: string): T | null {
  const val = genericCache.get<T>(key);
  return val !== undefined ? val : null;
}

export function set<T>(key: string, value: T, ttl?: number): void {
  if (ttl) {
    genericCache.set(key, value, ttl);
  } else {
    genericCache.set(key, value);
  }
}

export function del(key: string): void {
  genericCache.del(key);
}

// ─── Flush everything ─────────────────────────────────────────────────────────

export function flush(): void {
  searchCache.flushAll();
  bookCache.flushAll();
  relatedCache.flushAll();
  genericCache.flushAll();
  hits = 0;
  misses = 0;
  logger.info('Cache flushed');
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getStats(): Record<string, any> {
  return {
    search: {
      keys: searchCache.keys().length,
      hits: searchCache.getStats().hits,
      misses: searchCache.getStats().misses,
      ttl: config.cache.ttlSearch,
    },
    book: {
      keys: bookCache.keys().length,
      hits: bookCache.getStats().hits,
      misses: bookCache.getStats().misses,
      ttl: config.cache.ttlBook,
    },
    related: {
      keys: relatedCache.keys().length,
      hits: relatedCache.getStats().hits,
      misses: relatedCache.getStats().misses,
      ttl: config.cache.ttlRelated,
    },
    totalHits: hits,
    totalMisses: misses,
    hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : '0%',
  };
}
