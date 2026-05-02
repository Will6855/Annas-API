import type { Browser } from 'playwright';
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
 * Navigate to a URL with retry logic and Cloudflare challenge handling.
 * Returns the HTML content string on success.
 *
 * @param url
 * @param domain  - The domain being tried (for blacklisting)
 * @returns HTML
 */
export async function fetchPage(url: string, domain: string): Promise<string> {
  const browser = await browserPool.acquire();

  try {
    const { page, ctx } = await createStealthPage(browser);

    try {
      logger.debug(`Fetching: ${url}`);

      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout:   config.browser.timeout,
      });

      if (!response) throw new Error('No response received');

      const status = response.status();

      // Detect Cloudflare IUAM / challenge
      if (status === 403 || status === 429 || status === 503) {
        // Wait for Cloudflare to resolve (up to 10 s)
        try {
          await page.waitForSelector('body:not(.cf-mitigated)', { timeout: 10000 });
        } catch {
          // If it times out, check if page looks like a CF challenge
          const bodyText = await page.textContent('body').catch(() => '') || '';
          if (bodyText.includes('Cloudflare') || bodyText.includes('Just a moment')) {
            throw new Error(`Cloudflare challenge on ${domain} (HTTP ${status})`);
          }
        }
      }

      if (status >= 400) {
        throw new Error(`HTTP ${status} on ${domain}`);
      }

      // Wait for main content to appear
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});

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
 * Try each domain in rotation order until one succeeds or all fail.
 *
 * @param buildUrl  - Given a domain, returns the full URL
 */
export async function fetchWithRotation(buildUrl: (domain: string) => string): Promise<{ html: string, domain: string }> {
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
      
      // We check them sequentially to avoid overwhelming the browser pool
      for (const domain of domains) {
        try {
          await fetchPage(`https://${domain}/`, domain);
        } catch (err: any) {
          domainMgr.markFailed(domain, err.message);
        }
      }
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
