<div align="center">

# Anna's Archive API 📚

A production-ready REST API for searching and retrieving book metadata from **Anna's Archive**. Built with TypeScript and Express, it uses stealth Playwright automation to bypass bot detection, rotates across all mirrors, and features multi-layer caching with JWT authentication.

[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.18-black)](https://expressjs.com/)
[![Playwright](https://img.shields.io/badge/Playwright-1.52-green)](https://playwright.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> ⚠️ **Security Note**: This API scrapes third-party mirrors and uses browser automation. Deploy responsibly and respect rate limits.

[Features](#-key-features-at-a-glance) | [Getting Started](#-getting-started) | [API Reference](#-api-reference) | [Configuration](#-configuration)

</div>

## 🎯 Key Features at a Glance

- 🤖 **Stealth Scraping** — Playwright + CloakBrowser with user-agent rotation, Cloudflare challenge handling, and `navigator.webdriver` masking
- 🔄 **Domain Rotation** — Auto-rotates across all Anna's Archive mirrors with blacklisting, retries with exponential backoff, and background health checks
- ⚡ **Multi-Layer Caching** — Independent TTLs per resource (search, book, related) with pluggable `node-cache` (memory) or **Redis** engines
- 🔐 **JWT Authentication** — Role-based access control (`user` / `admin`) with login, registration, and user management
- 🏊 **Browser Pool** — Reusable Playwright instances with configurable pool size, FIFO request queuing, and idle timeout cleanup
- 📥 **Book Download** — Resolves real download links from slow servers and LibGen with automatic DDoS-guard cooldown handling
- 🔗 **Related Books Engine** — Multi-signal recommendation scoring (author, title keywords, publisher, extension)

## 🚀 Getting Started

1. **Clone & install**
	 ```bash
	 git clone https://github.com/will6855/annas-api.git
	 cd annas-api
	 npm install
	 ```

2. **Install browser** (required for scraping)
	 ```bash
	 npm run install:browsers
	 ```

3. **Start development server** (hot-reload)
	 ```bash
	 npm run dev
	 ```

4. **Production build**
	 ```bash
	 npm run build && npm start
	 ```

The server starts at **http://localhost:3000**.

## 📖 API Reference

All endpoints except `/health` and `/api/auth/login` require a **Bearer token** (admin role noted where required). Full OpenAPI spec at [openapi.yaml](./openapi.yaml).

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Server health, domain status, cache & pool stats | ❌ |
| `POST` | `/api/auth/login` | Login and get a JWT token | ❌ |
| `POST` | `/api/auth/register` | Register a new user | ✅ Admin |
| `GET` | `/api/auth/users` | List all registered users | ✅ Admin |
| `PUT` | `/api/auth/users/:id` | Update a user | ✅ Admin |
| `GET` | `/api/auth/me` | View own account & current rate limit usage | ✅ |
| `GET` | `/api/auth/users/:id/usage` | View API usage records for a user | ✅ Admin |
| `GET` | `/api/search` | Search for books | ✅ |
| `GET` | `/api/book/:md5` | Get full book details and download links | ✅ |
| `GET` | `/api/book/:md5/related` | Get related/similar books | ✅ |
| `GET` | `/api/book/:md5/download` | Download a book file | ✅ |
| `DELETE` | `/api/cache` | Flush the entire cache | ✅ Admin |

### Search
```
GET /api/search?q=<query>&page=<n>&lang=<lang>&ext=<ext>&sort=<sort>&content=<type>
```
Advanced multi-field search (up to 9 fields) with field types `title`, `author`, `publisher`, `edition_varia`, `year`, `original_filename`, `description_comments`:
```
GET /api/search?termtype_1=author&termval_1=asimov&termtype_2=year&termval_2=1950
```

| Param | Type | Description |
|---|---|---|
| `q` | `string` | Search query |
| `page` | `number` | Page number (default: `1`) |
| `lang` | `string` | Language filter (e.g. `en`, `fr`) |
| `ext` | `string` | Extension filter (e.g. `pdf`, `epub`) |
| `sort` | `enum` | `most_relevant`, `newest`, `oldest`, `largest`, `smallest`, `newest_added`, `oldest_added`, `random` |
| `content` | `enum` | `book_any`, `book_fiction`, `book_nonfiction`, `magazine`, `standards_document`, `comics`, `other` |
| `index` | `enum` | `journals`, `digital_lending`, `meta` |
| `termtype_N` | `enum` | Field type: `title`, `author`, `publisher`, `edition_varia`, `year`, `original_filename`, `description_comments` |
| `termval_N` | `string` | Field value (paired with `termtype_N`) |

### Book Details
```
GET /api/book/:md5?refresh=true
```
Returns full metadata: title, author, publisher, year, ISBN, collections, file paths, IPFS CIDs, and download links (fast, slow, external).

### Related Books
```
GET /api/book/:md5/related?limit=10
```
Scoring signals: author match (+30–70), title keywords (+15), publisher match (+10), same extension (+5). Near-duplicate titles penalized (−50).

### Download
```
GET /api/book/:md5/download?source=auto
```
| Param | Default | Description |
|---|---|---|
| `source` | `auto` | `auto` (libgen → slow), `libgen`, or `slow` |
| `refresh` | `false` | Bypass cache |

Automatically handles DDoS-guard challenges and LibGen ad-page link resolution, then streams the file.

### Health
```
GET /health
```
Returns uptime, server start time, live memory usage, per-domain up/down status, live cache statistics, and browser pool utilization. Domain status cached 10 min; everything else is fresh per request.

## 🔐 Authentication

The API uses **JWT-based authentication**. On first launch, a default admin is auto-seeded:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin` | `admin` |

> ⚠️ Change the default password immediately in production.

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
	-H "Content-Type: application/json" \
	-d '{"username":"admin","password":"admin"}'

# Use the returned token
curl http://localhost:3000/api/search?q=neuromancer \
	-H "Authorization: Bearer <token>"
```

| Role | Permissions |
|---|---|
| `admin` | Register/list/update users, view user API usage, flush cache, all data endpoints |
| `user` | Search, book details, related books, download |

Login and registration responses now include per-endpoint rate limit fields:

```json
{
	"user": {
		"rateLimitBookDetail": -1,
		"rateLimitBookDownload": -1,
		"rateLimitBookRelated": -1,
		"rateLimitSearch": -1
	}
}
```

`-1` means unlimited, `0` means blocked. Registering a new user applies the `DEFAULT_RATE_LIMIT_*` defaults.

### View your own rate limits

```
GET /api/auth/me
```

Returns your account details and real-time rate limit usage for the current window:

```json
{
	"user": { "id": "...", "username": "admin", "role": "admin" },
	"rateLimits": {
		"bookDetail":   { "limit": -1, "current": 0 },
		"bookDownload":  { "limit": -1, "current": 0 },
		"bookRelated":   { "limit": -1, "current": 0 },
		"search":        { "limit": -1, "current": 0 }
	}
}
```

### View user API usage (Admin)

```
GET /api/auth/users/:id/usage?limit=100&offset=0
```

Returns paginated usage records and current rate limit usage for a specific user. Max 500 records per request.

## ⚙️ Configuration

Configuration via environment variables (see `.env`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `development` / `production` |
| `CACHE_TYPE` | `memory` | `memory` or `redis` |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REDIS_PREFIX` | `annas-api:` | Redis key prefix |
| `CACHE_TTL_SEARCH` | `300` | Search cache TTL (s) |
| `CACHE_TTL_BOOK` | `3600` | Book detail TTL (s) |
| `CACHE_TTL_RELATED` | `3600` | Related books TTL (s) |
| `CACHE_TTL_DOMAIN` | `600` | Domain blacklist TTL (s) |
| `BROWSER_POOL_SIZE` | `2` | Max concurrent browsers |
| `BROWSER_TIMEOUT` | `30000` | Page timeout (ms) |
| `BROWSER_IDLE_TIMEOUT` | `60000` | Idle cleanup timeout (ms) |
| `MAX_RETRIES` | `2` | Scraping retries per domain |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `60000` | Rate limit window (ms) |
| `DEFAULT_RATE_LIMIT` | `100` | Default rate limit for all endpoints |
| `DEFAULT_RATE_LIMIT_BOOK_DETAIL` | `100` | Rate limit for book detail (per window) |
| `DEFAULT_RATE_LIMIT_BOOK_DOWNLOAD` | `100` | Rate limit for book download (per window) |
| `DEFAULT_RATE_LIMIT_BOOK_RELATED` | `100` | Rate limit for related books (per window) |
| `DEFAULT_RATE_LIMIT_SEARCH` | `100` | Rate limit for search (per window) |
| `RETRY_DELAY` | `1500` | Delay between scrape retries (ms) |
| `ROTATION_DOMAINS` | _(5 mirrors)_ | Comma-separated mirror list |
| `DATABASE_URL` | — | PostgreSQL URL (production) |
| `JWT_SECRET` | _(fallback)_ | JWT signing secret |
| `JWT_EXPIRES_IN` | `24h` | Token expiration |

### Caching
| Cache | Default TTL | Backend |
|---|---|---|
| Search results | 5 min | Memory (NodeCache) or Redis |
| Book details | 1 h | Memory (NodeCache) or Redis |
| Related books | 1 h | Memory (NodeCache) or Redis |
| Domain blacklist | 10 min | In-memory |

Flush cache: `DELETE /api/cache` (admin only).

### Domain Rotation
Default mirrors: `annas-archive.gl`, `annas-archive.org`, `annas-archive.se`, `annas-archive.gd`, `annas-archive.pk`.

The scraper tries healthy domains first, blacklists failures for `CACHE_TTL_DOMAIN` seconds, retries with exponential backoff, and falls back through the full list if all are blacklisted.

## 📁 Project Structure

```
src/
├── server.ts              # Express app — middleware, routes, startup
├── config.ts              # Environment variable config
├── logger.ts              # Winston logger (console + file)
├── browserPool.ts         # Playwright browser pool
├── cache.ts               # Caching abstraction (memory / Redis)
├── db.ts                  # TypeORM DataSource + auto-seed
├── domainManager.ts       # Domain health tracking & blacklist
├── types/index.ts         # TypeScript interfaces
├── entities/
│   ├── User.ts            # User entity (with per-endpoint rate limits)
│   └── ApiUsage.ts        # API usage tracking entity
├── middleware/
│   ├── auth.ts            # JWT auth & role guard
│   ├── usageTracker.ts    # API usage tracking middleware
│   └── userRateLimiter.ts # Per-endpoint rate limiter
├── routes/                # Express route handlers
│   ├── health.ts          # Health & cache management (up/down domain status)
│   ├── auth.ts            # Login, register, user CRUD, /me, /usage
│   ├── search.ts          # Book search
│   ├── book.ts            # Book details & download
│   └── related.ts         # Related recommendations
└── scraper/
    ├── index.ts           # Public scrape API
    ├── core.ts            # Stealth pages, fetch with rotation
    ├── parsers.ts         # HTML parsing (cheerio)
    └── related.ts         # Scoring, keywords, dedup
logs/                      # Runtime logs & debug screenshots
```

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| [TypeScript](https://www.typescriptlang.org/) | Language |
| [Express](https://expressjs.com/) | HTTP framework |
| [Playwright](https://playwright.dev/) + [CloakBrowser](https://www.npmjs.com/package/cloakbrowser) | Stealth browser automation |
| [Cheerio](https://cheerio.js.org/) | HTML parsing |
| [TypeORM](https://typeorm.io/) | Database ORM (SQLite dev / PostgreSQL prod) |
| [node-cache](https://www.npmjs.com/package/node-cache) / [ioredis](https://www.npmjs.com/package/ioredis) | Caching |
| [Winston](https://www.npmjs.com/package/winston) | Logging |
| [jsonwebtoken](https://www.npmjs.com/package/jsonwebtoken) + [bcrypt](https://www.npmjs.com/package/bcrypt) | Auth |
| [helmet](https://helmetjs.github.io/) + [express-rate-limit](https://www.npmjs.com/package/express-rate-limit) | Security |

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE).

---

<div align="center">

Made with TypeScript

[Report Bug](https://github.com/will6855/annas-api/issues) · [Request Feature](https://github.com/will6855/annas-api/issues)

</div>
