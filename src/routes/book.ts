import express, { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import * as browserPool from '../browserPool';
import * as scraper from '../scraper';
import * as cache from '../cache';
import { logger } from '../logger';

const router = express.Router();

/**
 * Create a new page from CloakBrowser - automatically has stealth enabled
 */
async function createPage(browser: any) {
  // CloakBrowser is Playwright-compatible and handles all stealth measures automatically
  const page = await browser.newPage();
  return page;
}

/**
 * GET /api/book/:md5
 *
 * Params:
 *   md5  {string}  - 32-character MD5 hash
 *
 * Query params:
 *   refresh  {boolean}  - If "true", bypass cache and force fresh scrape
 */
router.get('/:md5', async (req: Request, res: Response): Promise<any> => {
  const md5 = req.params.md5 as string;
  const forceRefresh = req.query.refresh === 'true';

  // Validate MD5 format
  if (!/^[a-f0-9]{32}$/i.test(md5)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid MD5 hash. Must be a 32-character hexadecimal string.',
    });
  }

  const start = Date.now();

  // ── Cache check ────────────────────────────────────────────────────────────
  if (!forceRefresh) {
    const cached = await cache.getBook(md5);
    if (cached) {
      logger.debug(`Cache HIT [book] ${md5}`);
      return res.json({
        ...cached,
        cached: true,
        responseTime: Date.now() - start,
      });
    }
  }

  // ── Live scrape ────────────────────────────────────────────────────────────
  try {
    const { book, domain } = await scraper.scrapeBook(md5.toLowerCase());

    if (!book.title) {
      return res.status(404).json({
        success: false,
        error: 'Book not found or page could not be parsed.',
        md5,
      });
    }

    const payload = {
      success: true,
      md5: md5.toLowerCase(),
      book,
      domain,
      cached: false,
      responseTime: Date.now() - start,
    };

    await cache.setBook(md5, payload);
    return res.json(payload);
  } catch (err: any) {
    logger.error(`Book scrape failed: ${err.message}`, { md5 });
    return res.status(502).json({
      success: false,
      error: err.message,
      md5,
    });
  }
});

/**
 * Extract the real download link from a slow server page by bypassing DDoS-guard and cooldown
 */
async function extractSlowDownloadLink(slowUrl: string): Promise<string> {
  const browser = await browserPool.acquire();

  try {
    const page = await createPage(browser);

    try {
      logger.debug(`Navigating to slow server page: ${slowUrl}`);

      // Add random delay to seem more human
      await page.waitForTimeout(Math.random() * 2000 + 1000);

      // Navigate with CloakBrowser's stealth - automatically handles bot detection
      await page.goto(slowUrl, { waitUntil: 'networkidle', timeout: 60000 });

      // Wait for any DDoS protection to resolve or cooldown timer
      // Check for common DDoS-guard patterns and wait if they exist
      try {
        // Try to detect and wait for DDoS-guard challenge page
        const isChallenge = await page.evaluate(() => {
          const bodyText = document.documentElement.innerHTML;
          return bodyText.includes('DDoS-GUARD') || 
                 bodyText.includes('ddos-guard') || 
                 bodyText.includes('Just a moment') ||
                 bodyText.includes('Cloudflare');
        });

        if (isChallenge) {
          logger.debug('DDoS-guard challenge detected, waiting for resolution...');
          // Wait up to 15 seconds for the challenge to resolve
          try {
            await page.waitForNavigation({ timeout: 15000, waitUntil: 'domcontentloaded' }).catch(() => {});
          } catch {
            // If navigation doesn't happen, just wait and check again
            await page.waitForTimeout(3000);
          }
        }
      } catch (err: any) {
        logger.debug(`DDoS-guard check failed: ${err.message}`);
      }

      // Wait for cooldown timer if present (usually a few seconds)
      try {
        const waitMs = await page.evaluate(() => {
          const text = document.body.textContent ?? '';
          const match = text.match(/(\d+)\s*seconds?/i);
          return match ? parseInt(match[1], 10) * 1000 : 0;
        });

        if (waitMs > 0) {
          logger.debug(`Cooldown detected, waiting ${waitMs / 1000 + 2}s...`);
          await page.waitForTimeout(waitMs + 2000);
        }
      } catch {
        // Continue if check fails
      }

      // Extract the download link from the <a href="...">📚 Download now</a> element
      const pageData = await page.evaluate(() => {
        // Get all links for debugging
        const links = Array.from(document.querySelectorAll('a'));
        const allLinks = links.map((el, idx) => ({
          index: idx,
          text: el.textContent?.substring(0, 50) || 'NO TEXT',
          href: el.getAttribute('href')?.substring(0, 100) || 'NO HREF',
          startsWithHttp: el.getAttribute('href')?.startsWith('http') || false,
        }));
        
        // Look for download link
        const downloadEl = links.find(el => 
          (el.textContent?.includes('Download') || el.textContent?.includes('📚')) && 
          el.getAttribute('href')?.startsWith('http')
        );
        
        return {
          downloadLink: downloadEl?.getAttribute('href') || null,
          totalLinks: links.length,
          allLinks: allLinks.slice(0, 30), // First 30 links
          pageTitle: document.title,
          pageUrl: window.location.href,
        };
      });

      logger.info(`Slow page debug - Title: "${pageData.pageTitle}", URL: ${pageData.pageUrl}, Total links: ${pageData.totalLinks}`);
      logger.debug(`First links found on slow page: ${JSON.stringify(pageData.allLinks.slice(0, 10))}`);

      if (!pageData.downloadLink) {
        // Save screenshot for debugging
        const screenshotPath = `./logs/slow_debug_${Date.now()}.png`;
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logger.warn(`No download link found on slow page. Screenshot saved to: ${screenshotPath}`);
        } catch (err: any) {
          logger.warn(`No download link found and screenshot failed: ${err.message}`);
        }
        throw new Error(`Could not extract download link from slow page. Found ${pageData.totalLinks} links but none matched criteria.`);
      }

      logger.info(`Extracted download link from slow server: ${pageData.downloadLink}`);
      return pageData.downloadLink;
    } finally {
      await page.close();
    }
  } finally {
    browserPool.release(browser);
  }
}

/**
 * Extract the real download link from a libgen ads page
 */
async function extractLibgenDownloadLink(adsUrl: string): Promise<string> {
  const browser = await browserPool.acquire();

  try {
    const page = await createPage(browser);

    try {
      logger.debug(`Navigating to libgen ads page: ${adsUrl}`);
      await page.goto(adsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Find the /get.php link
      const pageData = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const allLinks = links.map((el, idx) => ({
          index: idx,
          text: el.textContent?.substring(0, 50) || 'NO TEXT',
          href: el.getAttribute('href')?.substring(0, 100) || 'NO HREF',
          hasGetPhp: el.getAttribute('href')?.includes('get.php') || false,
        }));
        
        const getEl = links.find(el => 
          el.getAttribute('href')?.includes('get.php')
        );

        return {
          getLink: getEl?.getAttribute('href') || null,
          totalLinks: links.length,
          allLinks: allLinks.slice(0, 30),
          pageTitle: document.title,
          pageUrl: window.location.href,
        };
      });

      logger.info(`Libgen page debug - Title: "${pageData.pageTitle}", URL: ${pageData.pageUrl}, Total links: ${pageData.totalLinks}`);
      logger.debug(`First links found on libgen page: ${JSON.stringify(pageData.allLinks.slice(0, 15))}`);

      if (!pageData.getLink) {
        // Save screenshot for debugging
        const screenshotPath = `./logs/libgen_debug_${Date.now()}.png`;
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          logger.warn(`No /get.php link found on libgen ads page. Screenshot saved to: ${screenshotPath}`);
        } catch (err: any) {
          logger.warn(`No /get.php link found and screenshot failed: ${err.message}`);
        }
        throw new Error(`Could not find /get.php link on libgen ads page. Found ${pageData.totalLinks} links but none contained /get.php.`);
      }

      // Ensure it's a full URL
      const fullUrl = pageData.getLink.startsWith('http') ? pageData.getLink : new URL(pageData.getLink, adsUrl).toString();
      logger.info(`Extracted libgen download link: ${fullUrl}`);
      return fullUrl;
    } finally {
      await page.close();
    }
  } finally {
    browserPool.release(browser);
  }
}

/**
 * Attempt to download from a single URL with timeout
 */
function downloadFromUrl(url: string, timeout = 30000): Promise<{ statusCode: number; headers: any; stream: NodeJS.ReadableStream }> {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const req = protocol.get(url, { timeout }, (res) => {
        // Check if the response is successful
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            stream: res,
          });
        } else if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          // Handle redirects by following them
          const location = res.headers.location;
          if (location) {
            res.destroy();
            downloadFromUrl(location, timeout).then(resolve).catch(reject);
          } else {
            reject(new Error(`HTTP ${res.statusCode} (no redirect location)`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Try downloading from multiple slow links, extracting real links from each
 */
async function trySlowDownloadLinks(slowLinks: Array<{ label: string; url: string }>): Promise<{ url: string; statusCode: number; headers: any; stream: NodeJS.ReadableStream }> {
  const errors: Array<{ url: string; error: string }> = [];

  for (const link of slowLinks) {
    try {
      logger.debug(`Processing slow link: ${link.label} - ${link.url}`);
      
      // Extract the real download link from the slow server page
      const realDownloadLink = await extractSlowDownloadLink(link.url);
      
      // Now try to download from the real link
      logger.debug(`Attempting download from extracted link: ${realDownloadLink}`);
      const result = await downloadFromUrl(realDownloadLink);
      logger.info(`Download successful from: ${link.label}`);
      
      return {
        url: realDownloadLink,
        ...result,
      };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error';
      logger.debug(`Download failed from ${link.label}: ${errorMsg}`);
      errors.push({ url: link.url, error: errorMsg });
    }
  }

  // All links failed
  const errorSummary = errors.map(e => `${e.url}: ${e.error}`).join('; ');
  throw new Error(`All slow download links failed: ${errorSummary}`);
}

/**
 * Try downloading from libgen links
 */
async function tryLibgenDownloadLinks(externalLinks: Array<{ label: string; url: string }>): Promise<{ url: string; statusCode: number; headers: any; stream: NodeJS.ReadableStream }> {
  const errors: Array<{ url: string; error: string }> = [];

  for (const link of externalLinks) {
    try {
      logger.debug(`Processing libgen link: ${link.label} - ${link.url}`);
      
      // Extract the /get.php link from the ads page
      const realDownloadLink = await extractLibgenDownloadLink(link.url);
      
      // Now try to download from the real link
      logger.debug(`Attempting download from libgen /get.php link: ${realDownloadLink}`);
      const result = await downloadFromUrl(realDownloadLink);
      logger.info(`Download successful from: ${link.label}`);
      
      return {
        url: realDownloadLink,
        ...result,
      };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error';
      logger.debug(`Download failed from ${link.label}: ${errorMsg}`);
      errors.push({ url: link.url, error: errorMsg });
    }
  }

  // All links failed
  const errorSummary = errors.map(e => `${e.url}: ${e.error}`).join('; ');
  throw new Error(`All libgen download links failed: ${errorSummary}`);
}

/**
 * GET /api/book/:md5/download
 *
 * Download a book using fast/slow links or external (libgen) links.
 *
 * Params:
 *   md5  {string}  - 32-character MD5 hash
 *
 * Query params:
 *   source  {string}  - "libgen" (default) or "slow"
 *   refresh {boolean} - If "true", bypass cache and force fresh scrape
 */
router.get('/:md5/download', async (req: Request, res: Response): Promise<any> => {
  const md5 = req.params.md5 as string;
  const source = (req.query.source as string || 'libgen').toLowerCase();
  const forceRefresh = req.query.refresh === 'true';

  // Validate MD5 format
  if (!/^[a-f0-9]{32}$/i.test(md5)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid MD5 hash. Must be a 32-character hexadecimal string.',
    });
  }

  // Validate source parameter
  if (!['slow', 'libgen'].includes(source)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid source. Must be "slow" or "libgen".',
    });
  }

  try {
    // ── Fetch book details ─────────────────────────────────────────────────────
    let bookData = forceRefresh ? null : await cache.getBook(md5);

    if (!bookData) {
      logger.debug(`Fetching fresh book data for download: ${md5}`);
      const { book } = await scraper.scrapeBook(md5.toLowerCase());

      if (!book.title || !book.downloadLinks) {
        return res.status(404).json({
          success: false,
          error: 'Book not found or has no download links.',
          md5,
        });
      }

      bookData = {
        success: true,
        md5: md5.toLowerCase(),
        book,
        cached: false,
      };

      await cache.setBook(md5, bookData);
    }

    const book = bookData.book;

    // ── Select download links based on source ──────────────────────────────────
    let downloadResult: { url: string; statusCode: number; headers: any; stream: NodeJS.ReadableStream };

    if (source === 'slow') {
      const slowLinks = book.downloadLinks.slow || [];

      if (slowLinks.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No slow download links available for this book.',
          md5,
          source: 'slow',
        });
      }

      logger.info(`Starting slow download for ${md5} (${slowLinks.length} links available)`);
      downloadResult = await trySlowDownloadLinks(slowLinks);
      
    } else if (source === 'libgen') {
      // Filter external links for libgen ads pages (must contain /ads.php)
      const externalLinks = book.downloadLinks.external || [];
      const libgenLinks = externalLinks.filter(
        (link: { label: string; url: string }) => link.url.includes('/ads.php')
      );

      if (libgenLinks.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No libgen links available for this book.',
          md5,
          source: 'libgen',
        });
      }

      logger.info(`Starting libgen download for ${md5} (${libgenLinks.length} ads pages available)`);
      downloadResult = await tryLibgenDownloadLinks(libgenLinks);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid source. Must be "slow" or "libgen".',
      });
    }

    // ── Set response headers for file download ─────────────────────────────────
    const filename = book.filename || `${book.title}.${book.extension || 'bin'}`;
    res.setHeader('Content-Type', downloadResult.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Length', downloadResult.headers['content-length'] || '0');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // ── Stream the file ────────────────────────────────────────────────────────
    downloadResult.stream.pipe(res);

    downloadResult.stream.on('error', (err: any) => {
      logger.error(`Stream error during download: ${err.message}`, { md5, source });
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: 'Error during download streaming.',
          md5,
        });
      } else {
        res.end();
      }
    });
  } catch (err: any) {
    logger.error(`Download failed: ${err.message}`, { md5, source });
    return res.status(502).json({
      success: false,
      error: err.message,
      md5,
      source,
    });
  }
});

export default router;
