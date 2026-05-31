export interface LinkStatus {
  label: string;
  url: string;
}

export interface BookDownloadLinks {
  fast: LinkStatus[];
  slow: LinkStatus[];
  external: LinkStatus[];
}

export interface BookMetadata {
  sha256?: string;
  [key: string]: any; // Allow other parsed metadata
}

export interface SearchResult {
  md5: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  year: string | null;
  language: string | null;
  extension: string | null;
  filesize: string | null;
  description: string | null;
  cover: string | null;
  filename?: string | null;
  downloads?: number | null;
  lists?: number | null;
  bookType?: string | null;
  hasIssues?: boolean;
  url: string;
  relevanceScore?: number;
  matchedSignals?: string[];
}

export interface SearchResults {
  primary: SearchResult[];
  partial: SearchResult[];
}

export interface BookDetail extends SearchResult {
  isbn: string[];
  collections: string[];
  contentType: string | null;
  zlibId: string | null;
  ipfsCids: string[];
  filepaths: string[];
  downloadLinks: BookDownloadLinks;
  metadata: BookMetadata;
}

export interface AdvancedSearchField {
  termtype?: string | null; // title, author, publisher, edition_varia, year, original_filename, description_comments
  termval?: string | null;
}

export interface SearchFilters {
  lang?: string | null;
  ext?: string | null;
  sort?: string | null; // most_relevant, newest, oldest, largest, smallest, newest_added, oldest_added, random
  content?: string | null;
  index?: string | null;
  // Advanced search fields
  advancedSearch?: AdvancedSearchField[];
}

export interface ScrapeSearchResponse {
  results: SearchResults;
  domain: string;
}

export interface ScrapeBookResponse {
  book: BookDetail;
  domain: string;
}

export interface ScrapeRelatedResponse {
  results: SearchResult[];
  signals: string[];
  domain: string;
}

export interface DomainHealth {
  domain: string;
  status: 'up' | 'down';
  lastChecked?: string;
  lastError?: string | null;
}
