import express, { Request, Response } from 'express';
import * as scraper from '../scraper';
import * as cache from '../cache';
import { logger } from '../logger';
import { BookDetail } from '../types';

const router = express.Router();

/**
 * GET /api/book/:md5/related
 *
 * Returns similar/recommended books based on:
 *  - Author name  (strongest signal)
 *  - Top tag/category
 *  - Title keywords
 *
 * Query params:
 *   limit   {number}  default 10  - Max results (1–50)
 *   lang    {string}  optional    - Override language filter (default: same as source book)
 *   ext     {string}  optional    - Restrict to file extension
 *   refresh {boolean} optional    - Bypass cache
 */
router.get('/:md5/related', async (req: Request, res: Response): Promise<any> => {
  const md5 = req.params.md5 as string;
  const forceRefresh = req.query.refresh === 'true';
  const limit  = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '10', 10)));
  const lang   = (req.query.lang as string)  || null;
  const ext    = (req.query.ext as string)   || null;

  // Validate MD5 format
  if (!/^[a-f0-9]{32}$/i.test(md5)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid MD5 hash. Must be a 32-character hexadecimal string.',
    });
  }

  const start = Date.now();

  // ── Related cache check ────────────────────────────────────────────────────
  if (!forceRefresh) {
    const cached = await cache.getRelated(md5);
    if (cached) {
      logger.debug(`Cache HIT [related] ${md5}`);
      return res.json({ ...cached, cached: true, responseTime: Date.now() - start });
    }
  }

  // ── We need the source book — check book cache first, else scrape ──────────
  let sourceBook: BookDetail;
  const cachedBook = await cache.getBook(md5);
  if (cachedBook) {
    sourceBook = cachedBook.book;
    logger.debug(`Using cached book for related search: "${sourceBook.title}"`);
  } else {
    try {
      const { book } = await scraper.scrapeBook(md5.toLowerCase());
      if (!book.title) {
        return res.status(404).json({ success: false, error: 'Source book not found.', md5 });
      }
      // Store it in book cache for future calls
      await cache.setBook(md5, { success: true, md5: md5.toLowerCase(), book, cached: false });
      sourceBook = book;
    } catch (err: any) {
      logger.error(`Related: could not fetch source book ${md5}: ${err.message}`);
      return res.status(502).json({ success: false, error: err.message, md5 });
    }
  }

  // ── Run the related scrape ─────────────────────────────────────────────────
  try {
    const { results, signals, domain } = await scraper.scrapeRelated(sourceBook, { limit, lang, ext });

    const payload = {
      success: true,
      md5:     md5.toLowerCase(),
      source:  {
        title:     sourceBook.title,
        author:    sourceBook.author,
        language:  sourceBook.language,
        extension: sourceBook.extension,
      },
      signals,
      count:   results.length,
      results,
      domain,
      cached:  false,
      responseTime: Date.now() - start,
    };

    await cache.setRelated(md5, payload);
    return res.json(payload);
  } catch (err: any) {
    logger.error(`Related scrape failed: ${err.message}`, { md5 });
    return res.status(502).json({ success: false, error: err.message, md5 });
  }
});

export default router;
