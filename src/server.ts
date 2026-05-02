import 'reflect-metadata';
import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import * as browserPool from './browserPool';

// Routes
import searchRouter from './routes/search';
import bookRouter from './routes/book';
import relatedRouter from './routes/related';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import { initializeDatabase } from './db';

const app = express();

// ── Security & Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json());

// HTTP access logs (skip health endpoint spam)
app.use(morgan('combined', {
  stream: { write: (msg: string) => logger.http(msg.trim()) },
  skip:   (req: Request) => req.path === '/health',
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error:   'Too many requests. Please slow down.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000) + 's',
    });
  },
});
app.use('/api/', limiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRouter);
app.use('/health',       healthRouter);

// Require Bearer token for all other API endpoints
import { authenticate } from './middleware/auth';
app.use('/api/',         authenticate);

app.use('/api/cache',    healthRouter);   // DELETE /api/cache is on healthRouter
app.use('/api/search',   searchRouter);
app.use('/api/book',     relatedRouter);  // /api/book/:md5/related — must come before bookRouter
app.use('/api/book',     bookRouter);

// ── API root ──────────────────────────────────────────────────────────────────
app.get('/', (req: Request, res: Response) => {
  res.json({
    name:    "Anna's Archive API",
    version: '1.0.0',
    endpoints: {
      search: 'GET /api/search?q=<query>&page=<n>&lang=<lang>&ext=<ext>&sort=<sort>',
      book:   'GET /api/book/:md5',
      related: 'GET /api/book/:md5/related?limit=<n>',
      health: 'GET /health',
      cache:  'DELETE /api/cache',
    },
    docs: 'See README.md for full documentation.',
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = config.server.port;

app.listen(PORT, async () => {
  await initializeDatabase();
  logger.info(`🚀 Anna's Archive API running on http://localhost:${PORT}`);
  logger.info(`📋 Environment: ${config.server.env}`);
  logger.info(`🌐 Domain rotation: ${config.domains.join(' → ')}`);
  logger.info(`🗄️  Cache TTL: search=${config.cache.ttlSearch}s  book=${config.cache.ttlBook}s`);
  logger.info(`🏊 Browser pool size: ${config.browser.poolSize}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);
  await browserPool.shutdown();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

export default app; // for testing
