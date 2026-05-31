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
 *   q                 {string}  required  - Search query
 *   page              {number}  default 1
 *   lang              {string}  optional  - e.g. "en"
 *   ext               {string}  optional  - e.g. "pdf"
 *   sort              {string}  optional  - most_relevant|newest|oldest|largest|smallest|newest_added|oldest_added|random
 *   content           {string}  optional  - book_any|book_fiction|book_nonfiction|magazine|standards_document|comics|other
 *   index             {string}  optional  - journals|digital_lending|meta
 *   termtype_N        {string}  optional  - Advanced search field type (title|author|publisher|edition_varia|year|original_filename|description_comments)
 *   termval_N         {string}  optional  - Advanced search field value (N = 1, 2, 3, ...)
 */
router.get('/', async (req: Request, res: Response): Promise<any> => {
  const page = req.query.page as string | undefined;
  const lang = req.query.lang as string | undefined;
  const ext = req.query.ext as string | undefined;
  const sort = req.query.sort as string | undefined;
  const content = req.query.content as string | undefined;
  const index = req.query.index as string | undefined;

  const q = (req.query.q as string) || '';

  // Extract advanced search fields from query params (termtype_1, termval_1, termtype_2, termval_2, ...)
  // Extract advanced search fields from query params (termtype_1, termval_1, termtype_2, termval_2, ...)
  const advancedSearch: Array<{ termtype?: string | null; term?: string | null }> = [];
  let fieldIndex = 1;
  while (true) {
    const termtype = req.query[`termtype_${fieldIndex}`] as string | undefined;
    const term = req.query[`termval_${fieldIndex}`] as string | undefined;

    // Stop if no more fields
    if (!termtype && !term) break;

    // Add field if it has either termtype or term
    if (termtype || term) {
      advancedSearch.push({
        termtype: termtype || null,
        term: term || null,
      });
    }
    fieldIndex++;
  }

  const pageNum = Math.max(1, parseInt(page || '1', 10));
  const filters: SearchFilters = { 
    lang, 
    ext, 
    sort, 
    content, 
    index,
    ...(advancedSearch.length > 0 && { advancedSearch }),
  };

  const start = Date.now();

  // ── Cache check ────────────────────────────────────────────────────────────
  const cached = await cache.getSearch(q, pageNum, filters);
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

    await cache.setSearch(q, pageNum, filters, payload);
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
