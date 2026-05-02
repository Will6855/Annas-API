import dotenv from 'dotenv';
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env:  process.env.NODE_ENV || 'development',
  },

  cache: {
    ttlSearch:  parseInt(process.env.CACHE_TTL_SEARCH || '300',   10),
    ttlBook:    parseInt(process.env.CACHE_TTL_BOOK || '3600',     10),
    ttlRelated: parseInt(process.env.CACHE_TTL_RELATED || '3600',  10),
    ttlDomain:  parseInt(process.env.CACHE_TTL_DOMAIN || '60',   10),
  },

  browser: {
    poolSize: parseInt(process.env.BROWSER_POOL_SIZE || '2', 10),
    timeout:  parseInt(process.env.BROWSER_TIMEOUT || '30000', 10),
    idleTimeoutMs: parseInt(process.env.BROWSER_IDLE_TIMEOUT || '60000', 10),
  },

  scraping: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '2', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1500', 10),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10),
    max:      parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  domains: (process.env.ROTATION_DOMAINS || 'annas-archive.gl,annas-archive.org,annas-archive.se,annas-archive.gs,annas-archive.gd,annas-archive.pk')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean),

  db: {
    url: process.env.DATABASE_URL || '',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  }
};
