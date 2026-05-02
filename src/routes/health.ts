import express, { Request, Response } from 'express';
import * as cache from '../cache';
import * as domainMgr from '../domainManager';
import * as browserPool from '../browserPool';
import { refreshDomainStatus } from '../scraper/core';

const router = express.Router();

/**
 * GET /health
 * Returns API health, domain status, cache stats, and browser pool state.
 */
router.get('/', async (req: Request, res: Response) => {
  // Proactively check all domains
  await refreshDomainStatus().catch(err => {
    console.error('Failed to refresh domain status:', err);
  });

  res.json({
    success: true,
    status:  'ok',
    uptime:  Math.round(process.uptime()) + 's',
    memory:  formatMemory(process.memoryUsage()),
    domains: domainMgr.getDomainStatus(),
    cache:   cache.getStats(),
    browserPool: browserPool.stats(),
    timestamp: new Date().toISOString(),
  });
});

import { authenticate, requireRole } from '../middleware/auth';

/**
 * DELETE /api/cache
 * Flush all cached data.
 */
router.delete('/cache', authenticate, requireRole('admin'), (req: Request, res: Response) => {
  cache.flush();
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
