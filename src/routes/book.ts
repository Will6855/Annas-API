import express, { Request, Response } from 'express';
import * as scraper from '../scraper';
import * as cache from '../cache';
import { logger } from '../logger';

const router = express.Router();

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
    const cached = cache.getBook(md5);
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

    cache.setBook(md5, payload);
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

export default router;
