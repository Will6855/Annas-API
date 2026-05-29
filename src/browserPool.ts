import type { Browser } from 'playwright';
import { config } from './config';
import { logger } from './logger';

interface BrowserInstance {
  browser: Browser;
  lastUsed: number;
}

const pool: BrowserInstance[] = [];
let inUseCount = 0;
const waitingQueue: Array<(b: BrowserInstance) => void> = [];

let idleTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;

let launchFn: ((opts: any) => Promise<Browser>) | null = null;

/**
 * Initialize CloakBrowser launcher using dynamic import
 */
export async function initializeBrowserPool() {
  try {
    logger.info('Initializing CloakBrowser...');
    // @ts-ignore - Dynamic import for ES module
    const { launch } = await import('cloakbrowser');
    launchFn = launch;
    logger.info('✓ CloakBrowser initialized successfully');
    return true;
  } catch (err: any) {
    logger.error(`Failed to initialize CloakBrowser: ${err.message}`);
    throw err;
  }
}

/**
 * Launch a new browser instance
 */
async function launchBrowser(): Promise<BrowserInstance> {
  if (!launchFn) {
    throw new Error('Browser pool not initialized. Call initializeBrowserPool() first.');
  }

  logger.info(`Launching browser (pool: ${pool.length}/${config.browser.poolSize})`);

  const browser = await launchFn({
    headless: true,
  });

  const instance: BrowserInstance = { browser, lastUsed: Date.now() };

  // Handle unexpected crashes
  browser.on('disconnected', () => {
    if (isShuttingDown) return;
    logger.warn('Browser disconnected, removed from pool');
    const idx = pool.indexOf(instance);
    if (idx !== -1) pool.splice(idx, 1);
  });

  return instance;
}

/**
 * Acquire a browser from the pool, waiting if all are currently in use.
 */
export async function acquire(): Promise<Browser> {
  // Auto-initialize if not done yet
  if (!launchFn) {
    await initializeBrowserPool();
  }
  // Wait if pool is full and everything is busy
  if (pool.length >= config.browser.poolSize && pool.length <= inUseCount) {
    return new Promise<Browser>((resolve) => {
      waitingQueue.push((instance) => {
        inUseCount++;
        instance.lastUsed = Date.now();
        resolve(instance.browser);
      });
    });
  }

  // Find an available browser or launch a new one
  inUseCount++;
  
  if (pool.length > inUseCount - 1) {
    // There is an idle browser available
    const instance = pool[pool.length - 1]; // Just grab the last one (LIFOish)
    instance.lastUsed = Date.now();
    return instance.browser;
  }

  // Need to launch a new one
  try {
    const instance = await launchBrowser();
    pool.push(instance);
    return instance.browser;
  } catch (err) {
    inUseCount--;
    throw err;
  }
}

/**
 * Return a browser to the pool so it can be reused.
 */
export function release(browser: Browser): void {
  inUseCount--;
  
  const instance = pool.find(i => i.browser === browser);
  if (instance) {
    instance.lastUsed = Date.now();
    
    // Pass it to the next waiting request if any
    const next = waitingQueue.shift();
    if (next) {
      inUseCount++;
      next(instance);
    } else {
      scheduleIdleCleanup();
    }
  }
}

/**
 * Clean up browsers that have been idle for too long to free up memory.
 */
function scheduleIdleCleanup(): void {
  if (idleTimer) clearTimeout(idleTimer);
  
  idleTimer = setTimeout(async () => {
    if (inUseCount > 0) return; // Wait until nothing is happening

    const now = Date.now();
    for (let i = pool.length - 1; i >= 0; i--) {
      const instance = pool[i];
      if (now - instance.lastUsed > config.browser.idleTimeoutMs) {
        logger.info('Closing idle browser to free memory');
        pool.splice(i, 1);
        await instance.browser.close().catch(() => {});
      }
    }
  }, config.browser.idleTimeoutMs);
}

/**
 * Close all browsers and clear the pool.
 */
export async function shutdown(): Promise<void> {
  isShuttingDown = true;
  if (idleTimer) clearTimeout(idleTimer);
  
  logger.info('Shutting down browser pool...');
  const closes = pool.map(i => i.browser.close().catch(() => {}));
  await Promise.all(closes);
  
  pool.length = 0;
  inUseCount = 0;
  waitingQueue.length = 0;
}

/**
 * Get current stats of the browser pool.
 */
export function stats(): Record<string, any> {
  return {
    total: pool.length,
    inUse: inUseCount,
    idle: pool.length - inUseCount,
    maxSize: config.browser.poolSize,
  };
}
