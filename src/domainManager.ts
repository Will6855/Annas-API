import { config } from './config';
import { logger } from './logger';
import { DomainHealth } from './types';

// The baseline config list of domains
const mirrors = config.domains;

// In-memory blacklist of failing domains: Map<domain, unbanTimestampMs>
const blacklist = new Map<string, number>();

// Persistent history of domain health
interface DomainInfo {
  status: 'healthy' | 'down' | 'unknown';
  lastError?: string;
  lastChecked?: number;
}
const history = new Map<string, DomainInfo>();

/**
 * Get the list of domains, ordered by preference.
 * Domains that are blacklisted are moved to the bottom of the list.
 */
export function getOrderedDomains(): string[] {
  const now = Date.now();
  const healthy: string[] = [];
  const failing: string[] = [];

  for (const domain of mirrors) {
    const unbanTime = blacklist.get(domain);

    if (unbanTime && now < unbanTime) {
      // Still blacklisted
      failing.push(domain);
    } else {
      if (unbanTime) {
        // Blacklist expired, mark as healthy again in rotation
        blacklist.delete(domain);
        logger.info(`Domain ${domain} has been unbanned from blacklist.`);
      }
      healthy.push(domain);
    }
  }

  // If ALL domains are failing, we still have to try them (just in case they recovered)
  return [...healthy, ...failing];
}

/**
 * Mark a domain as failed. It will be blacklisted for the configured TTL.
 */
export function markFailed(domain: string, error?: string): void {
  const now = Date.now();
  const unbanTime = now + (config.cache.ttlDomain * 1000);
  blacklist.set(domain, unbanTime);

  history.set(domain, {
    status: 'down',
    lastError: error || 'Unknown error',
    lastChecked: now,
  });

  logger.warn(`Domain ${domain} blacklisted for ${config.cache.ttlDomain}s - Reason: ${error || 'Unknown'}`);
}

/**
 * Mark a domain as healthy, removing it from the blacklist if it was there.
 */
export function markHealthy(domain: string): void {
  if (blacklist.has(domain)) {
    blacklist.delete(domain);
  }

  history.set(domain, {
    status: 'healthy',
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
    const unbanTime = blacklist.get(domain);
    const isBlacklisted = unbanTime && now < unbanTime;

    // Status logic:
    // 1. If currently blacklisted -> 'blacklisted'
    // 2. If not blacklisted but last seen as down -> 'down'
    // 3. Otherwise -> 'healthy' (assumed healthy until proven otherwise)
    let status: DomainHealth['status'] = 'healthy';
    if (isBlacklisted) {
      status = 'blacklisted';
    } else if (info) {
      status = info.status;
    }

    return {
      domain,
      status,
      lastChecked: info?.lastChecked ? new Date(info.lastChecked).toISOString() : undefined,
      lastError: info?.lastError || null,
      blacklistedFor: isBlacklisted ? `${Math.ceil((unbanTime - now) / 1000)}s` : null,
    };
  });
}
