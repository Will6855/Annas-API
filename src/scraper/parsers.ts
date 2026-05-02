import * as cheerio from 'cheerio';
import { SearchResult, SearchResults, BookDetail, LinkStatus } from '../types';

/**
 * Parse search results from Anna's Archive HTML.
 * Returns primary results and partial matches separately.
 */

export function parseSearchResults(html: string, domain: string): SearchResults {
  const $ = cheerio.load(html);

  function parseRow($row: cheerio.Cheerio<any>): SearchResult | null {
    // --- MD5 ---
    const $coverLink = $row.find('a[href^="/md5/"]').first();
    const href = $coverLink.attr('href') || '';
    const md5 = href.replace('/md5/', '').split('?')[0].trim();
    if (!md5 || md5.length !== 32) return null;

    // --- Cover image (skip empty src) ---
    const $img = $coverLink.find('img').first();
    let cover: string | null = null;
    const imgSrc = $img.attr('src') || '';
    if (imgSrc) {
      cover = imgSrc.startsWith('http') ? imgSrc : `https://${domain}${imgSrc}`;
    }

    // --- Right-hand content column ---
    const $content = $row.find('div.max-w-full').first();

    // --- Filename (mono filepath above title) ---
    const filename = $content.find('div.font-mono').first().text().trim() || null;

    // --- Title (the blue semibold anchor pointing to /md5/) ---
    const $titleLink = $content.find('a.font-semibold[href^="/md5/"]').first();
    const title = $titleLink.text().trim();
    if (!title) return null;

    // --- Author & Publisher (search query links) ---
    // First search link = author (has user-edit icon), second = publisher (has company icon)
    let author: string | null = null;
    let publisher: string | null = null;
    let year: string | null = null;

    $content.find('a[href*="/search?q="]').each((_, a) => {
      const $a = $(a);
      // Skip the title link itself
      if ($a.attr('href')?.includes('/md5/')) return;
      const text = $a.text().trim();
      if (!text) return;
      if (!author) {
        author = text;
      } else if (!publisher) {
        publisher = text;
        // Extract year from "Publisher, 2014" or "Publisher, Paris, 2014" patterns
        const yearMatch = publisher.match(/\b((?:19|20)\d{2})\b/);
        if (yearMatch) {
          year = yearMatch[1];
          // Strip year and trailing content (e.g. ", Paris, impr. 2014, cop. 2014")
          publisher = publisher.replace(/[,\s]+(impr\.|cop\.)?\s*\b(?:19|20)\d{2}\b[^,]*/g, '').trim() || null;
        }
      }
    });

    // --- Description blurb ---
    // Lives in div.relative > div (the div before the "Read more" link)
    const $descDiv = $content.find('div.relative').first().find('div').first();
    const description = $descDiv.length
      ? $descDiv.text().trim().replace(/\s+/g, ' ') || null
      : null;

    // --- File metadata line ---
    // Format: "French [fr] · EPUB · 0.6MB · 2014 · 📕 Book (fiction) · 🚀/lgli/zlib"
    const $metaLine = $content.find('div.font-semibold.text-sm').first();
    const metaText = $metaLine.text();

    let language: string | null = null;
    let extension: string | null = null;
    let filesize: string | null = null;

    // Language: "French [fr]" — grab the ISO code in brackets
    const langMatch = metaText.match(/\[([a-z]{2,5})\]/i);
    if (langMatch) language = langMatch[1].toLowerCase();

    // Extension — delimited by · on both sides to avoid matching description words
    const extMatch = metaText.match(/·\s*(pdf|epub|mobi|djvu|fb2|azw3?|cbz|cbr|txt|docx?|zip|rar|7z|htm[l]?|rtf|lit|prc|lrf|mht|htmlz|cb7|odt|snb)\s*·/i);
    if (extMatch) extension = extMatch[1].toLowerCase();

    // File size
    const sizeMatch = metaText.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
    if (sizeMatch) filesize = `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}`;

    // Year fallback from meta line if not found via publisher string
    if (!year) {
      const yearMatch = metaText.match(/·\s*((?:19|20)\d{2})\s*·/);
      if (yearMatch) year = yearMatch[1];
    }

    // --- Download & list counts ---
    let downloads: number | null = null;
    let lists: number | null = null;

    $metaLine.find('span[title="Downloads"].whitespace-nowrap').each((_, el) => {
      const n = parseInt($(el).text().replace(/\D/g, ''), 10);
      if (!isNaN(n)) downloads = n;
    });
    $metaLine.find('span[title="Lists"].whitespace-nowrap').each((_, el) => {
      const n = parseInt($(el).text().replace(/\D/g, ''), 10);
      if (!isNaN(n)) lists = n;
    });

    // --- Book type / category (emoji + label before the · sources) ---
    // e.g. "📕 Book (fiction)", "📘 Book (non-fiction)", "📗 Book (unknown)", "💬 Comic book"
    const typeMatch = metaText.match(/[📕📘📗📰💬🎶📝🤨]\s*([^·\n]+)/u);
    const bookType = typeMatch ? typeMatch[1].trim() : null;

    // --- Issue flag (row has opacity-40 class) ---
    const hasIssues = $row.hasClass('opacity-40');

    return {
      md5,
      title,
      author,
      publisher,
      year,
      language,
      extension,
      filesize,
      description,
      cover,
      filename,
      downloads,
      lists,
      bookType,
      hasIssues,
      url: `https://${domain}/md5/${md5}`,
    };
  }

  function parseContainer($container: cheerio.Cheerio<any>): SearchResult[] {
    const results: SearchResult[] = [];
    const seenMd5 = new Set<string>();

    $container.find('div.flex.border-b').each((_, el) => {
      const result = parseRow($(el));
      if (result && !seenMd5.has(result.md5)) {
        seenMd5.add(result.md5);
        results.push(result);
      }
    });

    return results;
  }

  // Primary results: inside .js-aarecord-list-outer that is NOT inside .js-partial-matches-show
  const $primaryContainer = $('.js-partial-matches-show')
    .closest('.bg-white')
    .siblings('.bg-white')
    .find('.js-aarecord-list-outer')
    .first();

  // Fallback: take the first .js-aarecord-list-outer on the page
  const $firstOuter = $('.js-aarecord-list-outer').first();
  const primaryContainer = $primaryContainer.length ? $primaryContainer : $firstOuter;

  // Partial matches: inside .js-partial-matches-show
  const $partialContainer = $('.js-partial-matches-show .js-aarecord-list-outer').first();

  const primary = parseContainer(primaryContainer);
  const partial = $partialContainer.length ? parseContainer($partialContainer) : [];

  // Deduplicate partial against primary
  const primaryMd5s = new Set(primary.map(r => r.md5));
  const deduplicatedPartial = partial.filter(r => !primaryMd5s.has(r.md5));

  return { primary, partial: deduplicatedPartial };
}

/**
 * Parse full book detail from /md5/:hash page.
 * Extracts every field exposed by Anna's Archive including all identifiers,
 * filepaths, IPFS CIDs, dates, download links, and community stats.
 */
export function parseBookDetail(html: string, md5: string, domain: string): BookDetail {
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // ── Title ──────────────────────────────────────────────────────────────────
  let title: string | null = $('head title')
    .text()
    .trim()
    .replace(/\s*[-–]\s*Anna[''\u2019]s Archive$/i, '')
    .trim() || null;
  if (title === "Anna's Archive") title = null;

  // Fallback: grab the h1-like bold heading inside main
  if (!title) {
    title = $('.font-semibold.text-2xl').first().text().trim() || null;
  }

  // ── Author / Publisher ─────────────────────────────────────────────────────
  // The page renders author and publisher as search links.
  // Index 0 = search icon link (skip), 1 = author, 2 = publisher+meta string.
  const searchLinks = $('a[href*="/search?q="]').filter((_, el) => !!$(el).text().trim());
  const author = $(searchLinks[1]).text().trim() || null;
  const rawPub = $(searchLinks[2]).text().trim() || null;

  // Publisher string format: "Bloomsbury, Harry Potter, #4, London, Great Britain, 2015"
  let publisher: string | null = null;
  let series: string | null = null;
  let location: string | null = null;
  let year: string | null = null;

  if (rawPub) {
    const parts = rawPub.split(',').map(s => s.trim()).filter(Boolean);
    publisher = parts[0] ?? null;

    // Series: token containing '#'
    const seriesIdx = parts.findIndex(p => p.startsWith('#'));
    if (seriesIdx > 0) series = `${parts[seriesIdx - 1]}, ${parts[seriesIdx]}`;

    // Year: 4-digit number
    const yearToken = parts.find(p => /^(19|20)\d{2}$/.test(p));
    if (yearToken) year = yearToken;

    // Location: remaining tokens between series and year
    const skip = new Set([publisher, series?.split(', ')[0], series?.split(', ')[1], yearToken]);
    const locationParts = parts.filter(p => !skip.has(p) && !/^#/.test(p) && !/^(19|20)\d{2}$/.test(p));
    if (locationParts.length) location = locationParts.join(', ');
  }

  // Year fallback from codes panel tabs
  if (!year) {
    const yearTabMatch = bodyText.match(/\bYear\b[\s\S]{0,30}?\b((19|20)\d{2})\b/);
    if (yearTabMatch) year = yearTabMatch[1];
  }

  // ── Cover image ───────────────────────────────────────────────────────────
  let cover: string | null = null;
  $('img').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (src.includes('cover') || src.includes('thumb') || src.includes('/covers/')) {
      cover = src.startsWith('http') ? src : `https://${domain}${src}`;
      return false;
    }
  });

  // ── Description ───────────────────────────────────────────────────────────
  // Structure inside .js-md5-top-box-description:
  //   <div class="text-xs text-gray-500 uppercase">description</div>
  //   <div class="mb-1">The actual text…</div>
  // The label div contains the word "description" (uppercase styling, lowercase text).
  // The actual content is in the immediately following sibling div.
  let description: string | null = null;
  $('.js-md5-top-box-description').find('div').each((_, el) => {
    if ($(el).text().trim().toLowerCase() === 'description') {
      const text = $(el).next('div').text().trim();
      if (text) { description = text; return false; }
    }
  });

  // ── Language / Extension / Filesize / Content type ───────────────────────
  // All come from the codes panel tabs rendered as:
  //   <span class="...">KEY</span><span class="...">VALUE</span>
  // We read them AFTER identifiers is built below, so we use a local helper
  // that scans the tabs directly — same approach as identifiers further down.
  // NOTE: identifiers is populated after this block, so we do a targeted
  // tab scan here and reuse the same map once it exists.

  // Targeted tab scanner (runs before the full identifiers loop)
  const getTabValue = (key: string): string | null => {
    let found: string | null = null;
    $('.js-md5-codes-tabs-tab').each((_, el) => {
      const spans = $(el).find('span');
      if (spans.eq(0).text().trim() === key) {
        found = spans.eq(1).text().trim() || null;
        return false; // break
      }
    });
    return found;
  };

  // Language: codes tab "Language" → e.g. "en"
  const language: string | null = (() => {
    const v = getTabValue('Language');
    return v ? v.toLowerCase() : null;
  })();

  // Extension: inferred from any Filepath tab value
  const extension: string | null = (() => {
    let ext: string | null = null;
    $('.js-md5-codes-tabs-tab').each((_, el) => {
      const spans = $(el).find('span');
      if (spans.eq(0).text().trim() === 'Filepath') {
        const m = spans.eq(1).text().trim().match(/\.([a-z0-9]{2,5})$/i);
        if (m) { ext = m[1].toLowerCase(); return false; }
      }
    });
    return ext;
  })();

  // Filesize: codes tab "Filesize" → raw bytes integer string, e.g. "725408"
  const filesizeBytes: number | null = (() => {
    const v = getTabValue('Filesize');
    return v ? parseInt(v, 10) : null;
  })();

  const filesize: string | null = filesizeBytes !== null ? `${filesizeBytes} bytes` : null;

  // Content type: codes tab "Content Type" → e.g. "book_fiction"
  const contentType: string | null = getTabValue('Content Type');

  // ── ISBNs — derived from identifiers map after it is built (see below) ─────

  // ── All identifiers from the codes panel tabs ─────────────────────────────
  // Each tab has: <span class="...">KEY</span><span class="...">VALUE</span>
  const identifiers: Record<string, string[]> = {};
  $('.js-md5-codes-tabs-tab').each((_, el) => {
    const spans = $(el).find('span');
    const key = spans.eq(0).text().trim();
    const value = spans.eq(1).text().trim();
    if (key && value) {
      if (!identifiers[key]) identifiers[key] = [];
      if (!identifiers[key].includes(value)) identifiers[key].push(value);
    }
  });

  // Convenience extractors from the identifiers map
  const getId = (key: string): string | null => identifiers[key]?.[0] ?? null;
  const getIds = (key: string): string[] => identifiers[key] ?? [];

  // ── ISBNs — from identifiers map, stripping dashes from raw values ──────────
  // Tab labels are "ISBN-13" and "ISBN-10"; values like "978-1-4088-6542-2"
  const isbn: string[] = [
    ...getIds('ISBN-13').map(v => v.replace(/-/g, '')),
    ...getIds('ISBN-10').map(v => v.replace(/-/g, '')),
  ].filter((v, i, a) => a.indexOf(v) === i); // dedupe

  const zlibId = getId('Z-Library');
  const asin = getId('ASIN');
  const oclc = getId('OCLC');
  const openLibIds = getIds('Open Library');
  const goodreads = getId('Goodreads');
  const nexusstcId = getId('Nexus/STC');
  const sha1 = getId('SHA-1');
  const sha256 = getId('SHA-256');
  const ddc = getId('DDC');
  const bl = getId('BL');
  const bnb = getId('BNB');
  const zlibCatId = getId('Zlib Category ID');
  const zlibCatName = getId('Zlib Category Name');
  const lgliFictId = getId('Libgen.li fiction_id');
  const lgliFileId = getId('Libgen.li File');
  const aacIds = getIds('AacId');
  const serverPath = getId('Server Path');
  const torrent = getId('Torrent');

  // ── Dates ─────────────────────────────────────────────────────────────────
  const dates: Record<string, string> = {};
  const dateKeyMap: Record<string, string> = {
    'Year': 'year_published',
    'Z-Library Source Date': 'date_zlib_source',
    'Nexus/STC Source Updated Date': 'date_nexusstc_update',
    'Upload Collection Record Date': 'date_upload_record',
    "Libgen.li Source Date": 'date_lgli_source',
    "OpenLib 'created' Date": 'date_ol_created',
  };
  for (const [label, key] of Object.entries(dateKeyMap)) {
    const val = getId(label);
    if (val) dates[key] = val;
  }
  // date_open_sourced appears in the description block as plain text
  const dateOSMatch = $('div.js-md5-top-box-description').text().match(/date open sourced[\s\S]{0,10}?(\d{4}-\d{2}-\d{2})/i);
  if (dateOSMatch) dates['date_open_sourced'] = dateOSMatch[1];

  // ── File paths ────────────────────────────────────────────────────────────
  const filepaths: string[] = getIds('Filepath');

  // ── IPFS CIDs ─────────────────────────────────────────────────────────────
  const ipfsCids: string[] = getIds('IPFS CID');
  // Fallback regex in case selector missed
  if (!ipfsCids.length) {
    for (const m of bodyText.matchAll(/\b(Qm[a-zA-Z0-9]{44}|baf[a-zA-Z0-9]{56,})\b/g)) {
      if (!ipfsCids.includes(m[1])) ipfsCids.push(m[1]);
    }
  }

  // ── Collections ───────────────────────────────────────────────────────────
  const collections: string[] = getIds('Collection');

  // ── Community stats ───────────────────────────────────────────────────────
  // All three live in a single line of spans, selected by their title attribute:
  //   <span title="Downloads" class="whitespace-nowrap"><span class="icon-..."></span>32 149</span>
  //   <span title="Lists"     class="whitespace-nowrap"><span class="icon-..."></span>55</span>
  //   <span title="File issues" class="whitespace-nowrap text-red-500"><span class="icon-..."></span>3</span>
  // The inner icon <span> has no text content, so .text() returns just the number
  // (possibly with whitespace / non-breaking spaces from the icon margin).
  const parseSpanCount = (title: string): number | null => {
    // Strip commas (thousands separator, e.g. "32,178") and any whitespace/NBSP,
    // then parse. The result must be purely numeric after stripping.
    const raw = $(`span[title="${title}"].whitespace-nowrap`).first().text().replace(/[,\s\u00a0]/g, '');
    return raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : null;
  };
  const statsTotal: number | null = parseSpanCount('Downloads');
  const listsCount: number | null = parseSpanCount('Lists');
  const reportsCount: number | null = parseSpanCount('File issues');

  // ── Download links ─────────────────────────────────────────────────────────
  const fastLinks: LinkStatus[] = [];
  $('a[href*="/fast_download/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    // Skip sub-links like "(open in viewer)", "(no redirect)", "(short filename)"
    if (!href || text.startsWith('(')) return;
    const url = href.startsWith('http') ? href : `https://${domain}${href}`;
    if (!fastLinks.some(l => l.url === url)) {
      fastLinks.push({ label: text || 'Fast Server', url });
    }
  });

  const slowLinks: LinkStatus[] = [];
  $('a[href*="/slow_download/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || text.startsWith('(')) return;
    const url = href.startsWith('http') ? href : `https://${domain}${href}`;
    if (!slowLinks.some(l => l.url === url)) {
      slowLinks.push({ label: text || 'Slow Server', url });
    }
  });

  const externalLinks: LinkStatus[] = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().trim();
    if (!text) return;
    const isExternal =
      href.includes('libgen') ||
      href.includes('z-lib') ||
      href.startsWith('ipfs://') ||
      href.includes('libstc') ||
      href.includes('/ipfs_downloads/');
    if (isExternal && !externalLinks.some(l => l.url === href)) {
      externalLinks.push({ label: text, url: href });
    }
  });

  // ── Alternate filenames (from description block) ───────────────────────────
  const alternateFilenames: string[] = [];
  $('div.js-md5-top-box-description').find('div').each((_, el) => {
    const prev = $(el).prev('div').text().toLowerCase();
    if (prev.includes('alternative filename')) {
      const fn = $(el).text().trim();
      if (fn) alternateFilenames.push(fn);
    }
  });

  // ── Metadata bag (everything else worth keeping) ───────────────────────────
  const metadata: Record<string, any> = {
    ...(sha256 && { sha256 }),
    ...(sha1 && { sha1 }),
    ...(asin && { asin }),
    ...(oclc && { oclc }),
    ...(goodreads && { goodreads }),
    ...(nexusstcId && { nexusstc_id: nexusstcId }),
    ...(ddc && { ddc }),
    ...(bl && { bl }),
    ...(bnb && { bnb }),
    ...(zlibCatId && { zlib_category_id: zlibCatId }),
    ...(zlibCatName && { zlib_category_name: zlibCatName }),
    ...(lgliFictId && { lgli_fiction_id: lgliFictId }),
    ...(lgliFileId && { lgli_file_id: lgliFileId }),
    ...(openLibIds.length && { open_library_ids: openLibIds }),
    ...(aacIds.length && { aac_ids: aacIds }),
    ...(serverPath && { server_path: serverPath }),
    ...(torrent && { torrent }),
    ...(filesizeBytes !== null && { filesize_bytes: filesizeBytes }),
    ...(series && { series }),
    ...(location && { location }),
    ...(alternateFilenames.length && { alternate_filenames: alternateFilenames }),
    ...(Object.keys(dates).length && { dates }),
    ...(statsTotal !== null && { downloads_total: statsTotal }),
    ...(listsCount !== null && { lists_count: listsCount }),
    ...(reportsCount !== null && { reports_count: reportsCount }),
    identifiers,
  };

  return {
    md5,
    title,
    author,
    publisher,
    year,
    language,
    extension,
    filesize,
    isbn,
    description,
    cover,
    collections,
    contentType,
    zlibId,
    ipfsCids,
    filepaths,
    url: `https://${domain}/md5/${md5}`,
    downloadLinks: {
      fast: fastLinks,
      slow: slowLinks,
      external: externalLinks,
    },
    metadata,
  };
}