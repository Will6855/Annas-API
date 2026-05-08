# Anna's Archive API

A powerful, production-ready REST API for searching and retrieving book information from Anna's Archive. Features bot-detection bypass via stealth Playwright, intelligent domain rotation across all mirrors, and a multi-layer caching system.

## Features

- 🤖 **Stealth Scraping** — Playwright + stealth plugin bypasses Cloudflare & bot detection
- 🔄 **Domain Rotation** — Automatically rotates across all known Anna's Archive mirrors, falling back gracefully when one is down
- ⚡ **Smart Caching** — Multi-TTL in-memory cache: search results (5 min), book details (1 hour)
- 📄 **Pagination** — Full pagination support on search results
- 🏊 **Browser Pool** — Reusable browser instances for high performance
- 🛡️ **Rate Limiting** — Built-in per-IP rate limiting
- 📊 **Health Endpoint** — Domain health & cache statistics

## Setup

```bash
# Install dependencies
npm install

# Install Playwright's Chromium browser
npm run install:browsers

# Start in development mode
npm run dev

# Start in production
npm start
```

## API Documentation

The full API specification is available in [openapi.yaml](./openapi.yaml). You can visualize this file using tools like [Swagger Editor](https://editor.swagger.io/) or by installing the OpenAPI extension in your IDE.

## Mirrors / Domain Rotation

The API will automatically try these domains in order:
1. `annas-archive.gl`
2. `annas-archive.org`
3. `annas-archive.se`
4. `annas-archive.gs`
5. `annas-archive.gd`
6. `annas-archive.pk`

If a domain is unreachable, it is temporarily blacklisted and the next one is tried.

## Environment Variables

See `.env` for all configuration options. Key settings include:

- `PORT`: Server port (default: 3000)
- `CACHE_TYPE`: `memory` (default) or `redis`
- `REDIS_URL`: Redis connection string (e.g. `redis://localhost:6379`)
- `REDIS_PREFIX`: Prefix for keys in Redis (default: `annas-api:`)
- `CACHE_TTL_SEARCH`: TTL for search results in seconds (default: 300)
- `CACHE_TTL_BOOK`: TTL for book details in seconds (default: 3600)

## Caching Options

The API supports two caching engines:

### 1. In-Memory (NodeCache)
Default option. Best for single-instance deployments.
- Set `CACHE_TYPE=memory`
- Automatic cleanup of expired keys
- Lightning-fast retrieval

### 2. Redis
Best for multi-instance deployments or persistent caching.
- Set `CACHE_TYPE=redis`
- Configure via `REDIS_URL`
- Shared cache across multiple API nodes
- Survives application restarts
