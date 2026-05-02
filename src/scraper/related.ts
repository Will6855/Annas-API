import { BookDetail, SearchResult } from '../types';

/**
 * Extract the most meaningful keywords from a title, stripping stop words
 * and edition/volume noise so we get a tight, distinctive query.
 */
export function extractTitleKeywords(title: string): string {
  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
    'from', 'is', 'it', 'be', 'as', 'are', 'was', 'were', 'that', 'this', 'its',
    'edition', 'volume', 'vol', 'part', 'book', 'series', 'complete', 'guide',
    'introduction', 'intro', 'beginner', 'advanced', 'practical', 'hands',
  ]);

  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')       // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 5)                    // take top 5 keywords
    .join(' ');
}

/**
 * Score a candidate book against the source book across multiple signals.
 * Higher score = more relevant.
 */
export function scoreCandidate(source: BookDetail, candidate: SearchResult, signal: string): number {
  let score = 0;

  // Base score per signal type
  const BASE: Record<string, number> = { author: 30, tag: 20, title: 15 };
  score += BASE[signal] || 10;

  // Author match (exact, case-insensitive)
  if (source.author && candidate.author) {
    const srcAuthor = source.author.toLowerCase().trim();
    const candAuthor = candidate.author.toLowerCase().trim();
    if (srcAuthor === candAuthor) score += 40;
    else if (candAuthor.includes(srcAuthor) || srcAuthor.includes(candAuthor)) score += 20;
  }

  // Same file extension bonus (user probably wants same format)
  if (source.extension && candidate.extension && source.extension === candidate.extension) {
    score += 5;
  }

  // Publisher match (often indicates same series/imprint)
  if (source.publisher && candidate.publisher) {
    const srcPub = source.publisher.toLowerCase();
    const candPub = candidate.publisher.toLowerCase();
    if (srcPub === candPub) score += 10;
  }

  // Penalize if title is nearly identical (it's likely the same book, different format)
  if (source.title && candidate.title) {
    const srcTitle = source.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const candTitle = candidate.title.toLowerCase().replace(/\s+/g, ' ').trim();
    const similarity = titleSimilarity(srcTitle, candTitle);
    if (similarity > 0.85) score -= 50; // almost certainly the same book
  }

  return score;
}

/**
 * Simple Dice coefficient similarity for two strings (word-level).
 */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  return (2 * intersection) / (setA.size + setB.size);
}
