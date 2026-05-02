import express, { Request, Response } from 'express';
import * as scraper from '../scraper';
import * as cache from '../cache';
import { logger } from '../logger';
import { SearchFilters } from '../types';

const router = express.Router();

/**
 * GET /api/search
 *
 * Query params:
 *   q        {string}  required  - Search query
 *   page     {number}  default 1
 *   lang     {string}  optional  - e.g. "en"
 *   ext      {string}  optional  - e.g. "pdf"
 *   sort     {string}  optional  - newest|oldest|largest|smallest
 *   content  {string}  optional  - book_any|book_fiction|book_nonfiction|magazine|standards_document|comics|other
 *   index    {string}  optional  - journals|digital_lending|meta
 */
router.get('/', async (req: Request, res: Response): Promise<any> => {
  const q = req.query.q as string;
  const page = req.query.page as string | undefined;
  const lang = req.query.lang as string | undefined;
  const ext = req.query.ext as string | undefined;
  const sort = req.query.sort as string | undefined;
  const content = req.query.content as string | undefined;
  const index = req.query.index as string | undefined;

  if (!q || !q.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "q" is required',
    });
  }

  const pageNum = Math.max(1, parseInt(page || '1', 10));
  const filters: SearchFilters = { lang, ext, sort, content, index };

  const start = Date.now();

  // ── Cache check ────────────────────────────────────────────────────────────
  const cached = cache.getSearch(q, pageNum, filters);
  if (cached) {
    logger.debug(`Cache HIT [search] "${q}" p${pageNum}`);
    return res.json({
      ...cached,
      cached: true,
      responseTime: Date.now() - start,
    });
  }

  // ── Live scrape ────────────────────────────────────────────────────────────
  try {
    const { results, domain } = await scraper.scrapeSearch(q.trim(), pageNum, filters);

    const payload = {
      success: true,
      query: q.trim(),
      page: pageNum,
      filters: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
      count: results.primary.length + results.partial.length,
      results,
      domain,
      cached: false,
      responseTime: Date.now() - start,
    };

    cache.setSearch(q, pageNum, filters, payload);
    return res.json(payload);
  } catch (err: any) {
    logger.error(`Search failed: ${err.message}`, { query: q, page: pageNum });
    return res.status(502).json({
      success: false,
      error: err.message,
      query: q.trim(),
      page: pageNum,
    });
  }
});

export default router;
