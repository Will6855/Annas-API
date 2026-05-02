import { fetchWithRotation } from './core';
import { parseSearchResults, parseBookDetail } from './parsers';
import { extractTitleKeywords, scoreCandidate } from './related';
import { logger } from '../logger';
import { SearchFilters, ScrapeSearchResponse, ScrapeBookResponse, ScrapeRelatedResponse, BookDetail, SearchResult } from '../types';

/**
 * Scrape a search page for Anna's Archive.
 */
export async function scrapeSearch(query: string, page = 1, filters: SearchFilters = {}): Promise<ScrapeSearchResponse> {
  const { html, domain } = await fetchWithRotation((d) => {
    const params = new URLSearchParams({ q: query, page: String(page) });
    if (filters.lang) params.set('lang', filters.lang);
    if (filters.ext) params.set('ext', filters.ext);
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.content) params.set('content', filters.content);
    if (filters.index) params.set('index', filters.index);
    return `https://${d}/search?${params.toString()}`;
  });

  const results = parseSearchResults(html, domain);
  const totalFound = results.primary.length + results.partial.length;
  logger.info(`Search "${query}" p${page} → ${totalFound} results (${results.primary.length} primary, ${results.partial.length} partial) via ${domain}`);
  return { results, domain };
}

/**
 * Scrape full book details for a given MD5.
 */
export async function scrapeBook(md5: string): Promise<ScrapeBookResponse> {
  const { html, domain } = await fetchWithRotation(d => `https://${d}/md5/${md5}`);
  const book = parseBookDetail(html, md5, domain);
  logger.info(`Book detail "${md5}" → "${book.title}" via ${domain}`);
  return { book, domain };
}

/**
 * Scrape related/similar books for a given source book.
 */
export async function scrapeRelated(
  sourceBook: BookDetail,
  opts: { limit?: number; lang?: string | null; ext?: string | null } = {}
): Promise<ScrapeRelatedResponse> {
  const { limit = 10, lang, ext } = opts;
  const filters: SearchFilters = {
    lang: lang || sourceBook.language || null,
    ext: ext || null,
  };

  // ── Build search queries from the source book ──────────────────────────────
  const searchJobs: Array<{ query: string; signal: string }> = [];

  if (sourceBook.author && sourceBook.author.trim() && sourceBook.author !== '??') {
    searchJobs.push({ query: sourceBook.author.trim(), signal: 'author' });
  }

  if (sourceBook.title) {
    const kw = extractTitleKeywords(sourceBook.title);
    if (kw && kw.split(' ').length >= 2) {
      searchJobs.push({ query: kw, signal: 'title' });
    }
  }

  if (searchJobs.length === 0) {
    throw new Error('Not enough metadata on source book to find related titles.');
  }

  logger.info(
    `Related search for "${sourceBook.title}" — signals: ${searchJobs.map(j => `${j.signal}:"${j.query}"`).join(', ')}`
  );

  // ── Run searches in parallel ───────────────────────────────────────────────
  const settled = await Promise.allSettled(
    searchJobs.map(({ query, signal }) =>
      scrapeSearch(query, 1, filters).then(({ results, domain }) => ({
        results, signal, domain,
      }))
    )
  );

  // ── Merge, score, deduplicate ──────────────────────────────────────────────
  const pool = new Map<string, { book: SearchResult, score: number, signals: string[] }>();
  let primaryDomain = '';

  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') {
      logger.warn(`Related sub-search failed: ${outcome.reason?.message}`);
      continue;
    }

    const { results, signal, domain } = outcome.value;
    if (!primaryDomain) primaryDomain = domain;

    // Merge both primary and partial results for related search pool
    const allResults = [...results.primary, ...results.partial];

    for (const candidate of allResults) {
      // Skip the source book itself
      if (candidate.md5 === sourceBook.md5) continue;

      // Hard filter: ensure same language if available
      if (sourceBook.language && candidate.language && candidate.language !== sourceBook.language) {
        continue;
      }

      const score = scoreCandidate(sourceBook, candidate, signal);
      if (score <= 0) continue;  // not relevant enough

      if (pool.has(candidate.md5)) {
        const existing = pool.get(candidate.md5)!;
        existing.score += score;                              // additive — appears in multiple signals
        if (!existing.signals.includes(signal)) existing.signals.push(signal);
      } else {
        pool.set(candidate.md5, { book: candidate, score, signals: [signal] });
      }
    }
  }

  // ── Sort and cap ───────────────────────────────────────────────────────────
  const sorted = [...pool.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ book, score, signals }) => ({
      ...book,
      relevanceScore: score,
      matchedSignals: signals,
    }));

  const usedSignals = searchJobs.map(j => j.signal);
  logger.info(`Related results for "${sourceBook.title}": ${sorted.length} found`);

  return { results: sorted, signals: usedSignals, domain: primaryDomain };
}
