import { config } from './config';
import { logger } from './logger';
import { DomainHealth } from './types';

// The baseline config list of domains
const mirrors = config.domains;


// Persistent history of domain health
const RATE_LIMIT_TTL_MS = 2 * 60 * 1000; // 2 minutes

interface DomainInfo {
  status: 'healthy' | 'down' | 'rate-limited' | 'unknown';
  lastError?: string;
  lastChecked?: number;
}
const history = new Map<string, DomainInfo>();

/**
 * Get the list of domains, ordered by preference.
 * Domains that are down are moved to the bottom of the list.
 */
export function getOrderedDomains(): string[] {
  const now = Date.now();
  const healthy: string[] = [];
  const failing: string[] = [];

  for (const domain of mirrors) {
    const info = history.get(domain);

    if (info?.status === 'down' && info.lastChecked && (now - info.lastChecked) < config.cache.ttlDomain * 1000) {
      failing.push(domain);
    } else if (info?.status === 'rate-limited' && info.lastChecked && (now - info.lastChecked) < RATE_LIMIT_TTL_MS) {
      failing.push(domain);
    } else {
      healthy.push(domain);
    }
  }

  // If ALL domains are failing, we still have to try them (just in case they recovered)
  return [...healthy, ...failing];
}

/**
 * Mark a domain as failed. It will stay down until the health refresh interval passes.
 */
export function markFailed(domain: string, error?: string): void {
  const now = Date.now();

  history.set(domain, {
    status: 'down',
    lastError: error || 'Unknown error',
    lastChecked: now,
  });

  logger.warn(`Domain ${domain} marked down (will recheck in ${config.cache.ttlDomain}s) - Reason: ${error || 'Unknown'}`);
}

/**
 * Mark a domain as rate-limited (429). It will be skipped for 2 minutes, then retried.
 */
export function markRateLimited(domain: string): void {
  history.set(domain, {
    status: 'rate-limited',
    lastError: 'HTTP 429 Too Many Requests',
    lastChecked: Date.now(),
  });

  logger.warn(`Domain ${domain} rate-limited (429) — will recheck in 2 minutes`);
}

/**
 * Mark a domain as healthy.
 */
export function markHealthy(domain: string): void {
  history.set(domain, {
    status: 'healthy' as const,
    lastChecked: Date.now(),
    lastError: null as any,
  });

  logger.info(`Domain ${domain} is healthy.`);
}

/**
 * Returns ms until the next temporarily-blocked domain becomes available again.
 * Returns null when no domain is in a temporary state (all are healthy or hard-failed with no recorded TTL).
 * Used by fetchWithRotation to decide how long to wait before retrying.
 */
export function getEarliestRecoveryMs(): number | null {
  const now = Date.now();
  let earliest: number | null = null;

  for (const domain of mirrors) {
    const info = history.get(domain);
    if (!info?.lastChecked) continue;

    let expiresAt: number | null = null;
    if (info.status === 'rate-limited') {
      expiresAt = info.lastChecked + RATE_LIMIT_TTL_MS;
    } else if (info.status === 'down') {
      expiresAt = info.lastChecked + config.cache.ttlDomain * 1000;
    }

    if (expiresAt !== null && expiresAt > now) {
      const remaining = expiresAt - now;
      if (earliest === null || remaining < earliest) earliest = remaining;
    }
  }

  return earliest;
}

/**
 * Get the current health status of all tracked domains.
 */
export function getDomainStatus(): DomainHealth[] {
  const now = Date.now();
  return mirrors.map(domain => {
    const info = history.get(domain);
    const isDown = info?.status === 'down' && !!info.lastChecked && (now - info.lastChecked) < config.cache.ttlDomain * 1000;
    const isRateLimited = info?.status === 'rate-limited' && !!info.lastChecked && (now - info.lastChecked) < RATE_LIMIT_TTL_MS;

    let status: DomainHealth['status'] = 'up';
    if (isDown) {
      status = 'down';
    } else if (isRateLimited) {
      status = 'rate-limited';
    }

    return {
      domain,
      status,
      lastChecked: info?.lastChecked ? new Date(info.lastChecked).toISOString() : undefined,
      lastError: info?.lastError || null,
    };
  });
}
