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

export interface SearchFilters {
  lang?: string | null;
  ext?: string | null;
  sort?: string | null;
  content?: string | null;
  index?: string | null;
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
  status: 'healthy' | 'blacklisted' | 'down' | 'unknown';
  lastChecked?: string;
  lastError?: string | null;
  blacklistedFor: string | null;
}
