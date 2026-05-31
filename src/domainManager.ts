import { config } from './config';
import { logger } from './logger';
import { DomainHealth } from './types';

// The baseline config list of domains
const mirrors = config.domains;


// Persistent history of domain health
interface DomainInfo {
  status: 'healthy' | 'down' | 'unknown';
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
      // Still within the down grace period
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
 * Get the current health status of all tracked domains.
 */
export function getDomainStatus(): DomainHealth[] {
  const now = Date.now();
  return mirrors.map(domain => {
    const info = history.get(domain);
    const isDown = info?.status === 'down' && !!info.lastChecked && (now - info.lastChecked) < config.cache.ttlDomain * 1000;

    let status: DomainHealth['status'] = 'up';
    if (isDown) {
      status = 'down';
    }

    return {
      domain,
      status,
      lastChecked: info?.lastChecked ? new Date(info.lastChecked).toISOString() : undefined,
      lastError: info?.lastError || null,
    };
  });
}
