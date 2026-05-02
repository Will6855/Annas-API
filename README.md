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

## API Endpoints

### `GET /api/search`
Search for books by any query (title, author, ISBN, DOI, MD5, etc.)

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | required | Search query |
| `page` | number | 1 | Page number |
| `lang` | string | — | Language filter (e.g. `en`) |
| `ext` | string | — | File extension filter (e.g. `pdf`, `epub`) |
| `sort` | string | — | Sort order (`newest`, `oldest`, `largest`, `smallest`) |
| `content` | string | — | Content type filter |

**Response:**
```json
{
  "success": true,
  "query": "python programming",
  "page": 1,
  "results": [...],
  "cached": false,
  "domain": "annas-archive.gl",
  "responseTime": 1234
}
```

---

### `GET /api/book/:md5`
Get full details for a specific book by its MD5 hash.

**Response:**
```json
{
  "success": true,
  "md5": "d64efd386ed7227592499460aca2044b",
  "book": {
    "title": "Data Science Essentials in Python",
    "author": "Dmitry Zinoviev",
    "publisher": "Pragmatic Bookshelf",
    "year": "2016",
    "language": "en",
    "filesize": 6432380,
    "extension": "pdf",
    "isbn": ["9781680501841", "1680501844"],
    "description": "...",
    "cover": "https://...",
    "md5": "d64efd386ed7227592499460aca2044b",
    "downloadLinks": {
      "fast": [...],
      "slow": [...],
      "external": [...]
    },
    "metadata": {...}
  },
  "cached": true,
  "responseTime": 45
}
```

---

### `GET /health`
Returns API health, domain status, cache stats, and browser pool status.

---

### `DELETE /api/cache`
Clears the entire cache. Useful for forced refresh.

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

See `.env` for all configuration options.
