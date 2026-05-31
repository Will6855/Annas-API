import type { Browser } from 'playwright';
import axios from 'axios';
import http from 'http';
import https from 'https';
import * as browserPool from '../browserPool';
import * as domainMgr from '../domainManager';
import { config } from '../config';
import { logger } from '../logger';

// ── Stealth page helpers ─────────────────────────────────────────────────────

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Create a hardened page with stealth settings applied.
 */
async function createStealthPage(browser: Browser) {
  const ctx = await browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  const page = await ctx.newPage();

  // Mask automation markers
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  return { page, ctx };
}

/**
 * HTTP-client headers that mimic a real browser.
 */
function httpHeaders(domain: string) {
  const ua = randomUA();
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': `https://${domain}/`,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0',
  };
}

// Axios instance with keep-alive for connection reuse
const httpClient = axios.create({
  timeout: config.browser.timeout,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  maxRedirects: 5,
  decompress: true,
});

/**
 * Attempt to fetch a page via plain HTTP (axios).
 * Much faster than Playwright — no browser overhead.
 * Returns HTML string on success, or null if we hit a Cloudflare challenge.
 * Throws on network errors / bad status codes.
 */
async function simpleFetchPage(url: string, domain: string): Promise<string | null> {
  try {
    logger.debug(`HTTP fetch: ${url}`);
    const resp = await httpClient.get(url, {
      headers: httpHeaders(domain),
      responseType: 'text',
      validateStatus: (status) => status < 400 || status === 403 || status === 429 || status === 503,
    });

    const status = resp.status;
    const body: string = resp.data;

    // Detect Cloudflare challenge pages
    if (status === 403 || status === 429 || status === 503) {
      if (body.includes('Cloudflare') || body.includes('Just a moment') || body.includes('cf-browser-verify') || body.includes('__cf_challenge')) {
        logger.debug(`Cloudflare challenge detected on ${domain} (HTTP ${status}) — will fall back to Playwright`);
        return null; // signal fallback to Playwright
      }
    }

    if (status >= 400) {
      throw new Error(`HTTP ${status} on ${domain}`);
    }

    domainMgr.markHealthy(domain);
    return body;
  } catch (err: any) {
    // Network errors (DNS, connection refused, timeout) — allow retry
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      throw err; // will be caught by fetchWithRotation → retry
    }
    // For other errors (e.g. invalid URL, parsing), re-throw
    if (!err.response) throw err;

    // If we got a non-Cloudflare 4xx/5xx, throw
    throw err;
  }
}

// ── Playwright fallback ─────────────────────────────────────────────────────

/**
 * Navigate to a URL with retry logic and Cloudflare challenge handling.
 * Returns the HTML content string on success.
 *
 * @param url
 * @param domain  - The domain being tried (for tracking up/down status)
 * @returns HTML
 */
async function playwrightFetchPage(url: string, domain: string): Promise<string> {
  // Reduce pool contention: acquire only when we really need Playwright
  const browser = await browserPool.acquire();

  try {
    const { page, ctx } = await createStealthPage(browser);

    try {
      logger.debug(`PW fetch: ${url}`);

      const response = await page.goto(url, {
        waitUntil: 'load',
        timeout:   config.browser.timeout,
      });

      if (!response) throw new Error('No response received');

      const status = response.status();

      // Detect Cloudflare IUAM / challenge
      if (status === 403 || status === 429 || status === 503) {
        // Quick check for Cloudflare — just look at the body text right away
        const bodyText = await page.textContent('body').catch(() => '') || '';
        if (bodyText.includes('Cloudflare') || bodyText.includes('Just a moment') || bodyText.includes('cf-browser-verify')) {
          // Wait a bit for CF to resolve (up to 5s)
          try {
            await page.waitForFunction(
              () => !document.body.innerText.includes('Just a moment'),
              { timeout: 5000 }
            );
          } catch {
            throw new Error(`Cloudflare challenge on ${domain} (HTTP ${status})`);
          }
        }
      }

      if (status >= 400) {
        throw new Error(`HTTP ${status} on ${domain}`);
      }

      const html = await page.content();
      domainMgr.markHealthy(domain);
      return html;
    } finally {
      await ctx.close().catch(() => {});
    }
  } finally {
    browserPool.release(browser);
  }
}

/**
 * Hybrid fetch: try simple HTTP first, fall back to Playwright if Cloudflare.
 *
 * @param url
 * @param domain  - The domain being tried
 * @returns HTML
 */
async function fetchPage(url: string, domain: string): Promise<string> {
  // 1. Try simple HTTP (fast path)
  const result = await simpleFetchPage(url, domain);
  if (result !== null) return result;

  // 2. Fall back to Playwright for Cloudflare bypass
  logger.info(`Falling back to Playwright for ${domain}`);
  return playwrightFetchPage(url, domain);
}

/**
 * Try each domain in rotation order until one succeeds or all fail.
 */
export async function fetchWithRotation(buildUrl: (domain: string) => string): Promise<{ html: string; domain: string }> {
  const domains = domainMgr.getOrderedDomains();
  let lastError: Error | undefined;

  for (const domain of domains) {
    const url = buildUrl(domain);
    for (let attempt = 1; attempt <= config.scraping.maxRetries; attempt++) {
      try {
        const html = await fetchPage(url, domain);
        return { html, domain };
      } catch (err: any) {
        logger.warn(`[${domain}] Attempt ${attempt}/${config.scraping.maxRetries} failed: ${err.message}`);
        lastError = err;

        if (attempt < config.scraping.maxRetries) {
          await sleep(config.scraping.retryDelay * attempt); // exponential-ish backoff
        }
      }
    }

    // All retries exhausted for this domain
    domainMgr.markFailed(domain, lastError?.message);
    logger.warn(`All retries failed for ${domain}, rotating to next mirror`);
  }

  throw new Error(`All mirrors unreachable. Last error: ${lastError?.message}`);
}

let refreshPromise: Promise<void> | null = null;

/**
 * Proactively check the health of all configured domains.
 * Uses a singleton promise to avoid multiple simultaneous refreshes.
 */
export async function refreshDomainStatus(): Promise<void> {
  if (refreshPromise) {
    logger.debug('Domain refresh already in progress, waiting...');
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      logger.info('Refreshing all domain statuses...');
      const domains = config.domains;

      // Check all domains concurrently via simple HTTP (no browser needed)
      await Promise.allSettled(domains.map(async (domain) => {
        try {
          const result = await simpleFetchPage(`https://${domain}/`, domain);
          if (result === null) {
            domainMgr.markFailed(domain, 'Cloudflare challenge during refresh');
          }
        } catch (err: any) {
          domainMgr.markFailed(domain, err.message);
        }
      }));
      logger.info('Domain status refresh complete.');
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}
