import express, { Request, Response } from 'express';
import * as cache from '../cache';
import * as domainMgr from '../domainManager';
import * as browserPool from '../browserPool';
import { refreshDomainStatus } from '../scraper/core';

const router = express.Router();

// Health data cache (10-minute refresh interval)
export const HEALTH_CACHE_INTERVAL = 10 * 60 * 1000; // 10 minutes in milliseconds
interface CachedHealth {
  data: any;
  lastActualized: Date;
}

let healthCache: CachedHealth | null = null;

/**
 * Refresh health data (called by background interval)
 */
export async function refreshHealthData() {
  try {
    await refreshDomainStatus().catch(err => {
      console.error('Failed to refresh domain status:', err);
    });

    const stats = await cache.getStats();
    healthCache = {
      data: {
        success: true,
        status: 'ok',
        uptime: Math.round(process.uptime()) + 's',
        memory: formatMemory(process.memoryUsage()),
        domains: domainMgr.getDomainStatus(),
        cache: stats,
        browserPool: browserPool.stats(),
      },
      lastActualized: new Date(),
    };
  } catch (err) {
    console.error('Failed to refresh health data:', err);
  }
}

/**
 * GET /health
 * Returns API health, domain status, cache stats, and browser pool state.
 * Data is cached and only updated every 10 minutes on the server side.
 * However, uptime and blacklistedFor timestamps are recalculated per request.
 */
router.get('/', async (req: Request, res: Response) => {
  // Initialize cache if empty
  if (!healthCache) {
    await refreshHealthData();
  }

  if (!healthCache) {
    return res.status(500).json({ success: false, error: 'Health data unavailable' });
  }

  const now = new Date();
  const timeSinceRefresh = now.getTime() - healthCache.lastActualized.getTime();
  const timeUntilNextUpdate = Math.max(0, HEALTH_CACHE_INTERVAL - timeSinceRefresh);

  // Recalculate dynamic values on each request
  const updatedUptime = Math.round(process.uptime()) + 's';
  const domainsWithFreshTimestamps = domainMgr.getDomainStatus(); // Refreshes blacklistedFor countdown

  res.json({
    ...healthCache.data,
    uptime: updatedUptime,
    domains: domainsWithFreshTimestamps,
    lastActualized: healthCache.lastActualized.toISOString(),
    timeUntilNextUpdate: Math.round(timeUntilNextUpdate / 1000) + 's',
    timestamp: now.toISOString(),
  });
});

import { authenticate, requireRole } from '../middleware/auth';

/**
 * DELETE /api/cache
 * Flush all cached data.
 */
router.delete('/cache', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  await cache.flush();
  res.json({ success: true, message: 'Cache flushed successfully' });
});

function formatMemory(mem: NodeJS.MemoryUsage) {
  const toMB = (v: number) => (v / 1024 / 1024).toFixed(1) + ' MB';
  return {
    rss:       toMB(mem.rss),
    heapUsed:  toMB(mem.heapUsed),
    heapTotal: toMB(mem.heapTotal),
    external:  toMB(mem.external),
  };
}

export default router;
