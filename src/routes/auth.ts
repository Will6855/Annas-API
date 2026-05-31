import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../db';
import { User } from '../entities/User';
import { ApiKey } from '../entities/ApiKey';
import { config } from '../config';
import { authenticate, requireRole } from '../middleware/auth';
import { trackUsage } from '../middleware/usageTracker';
import { ApiUsage } from '../entities/ApiUsage';
import { getUserRateLimitProgress } from '../middleware/userRateLimiter';
import { invalidateCachedKey } from '../apiKeyCache';
import crypto from 'crypto';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOneBy({ username });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn as any }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        rateLimitBookDetail: user.rateLimitBookDetail,
        rateLimitBookDownload: user.rateLimitBookDownload,
        rateLimitBookRelated: user.rateLimitBookRelated,
        rateLimitSearch: user.rateLimitSearch,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/register (Only admins can create new users)
router.post('/register', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    const userRepository = AppDataSource.getRepository(User);
    
    const existingUser = await userRepository.findOneBy({ username });
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = userRepository.create({
      username,
      password: hashedPassword,
      role: role || 'user',
      rateLimitBookDetail: config.defaultRateLimits.bookDetail,
      rateLimitBookDownload: config.defaultRateLimits.bookDownload,
      rateLimitBookRelated: config.defaultRateLimits.bookRelated,
      rateLimitSearch: config.defaultRateLimits.search,
    });

    await userRepository.save(user);

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        rateLimitBookDetail: user.rateLimitBookDetail,
        rateLimitBookDownload: user.rateLimitBookDownload,
        rateLimitBookRelated: user.rateLimitBookRelated,
        rateLimitSearch: user.rateLimitSearch,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/auth/users (Only admins can view all users)
router.get('/users', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const usersWithLimits = await userRepository.find({select: { id: true, username: true, role: true, createdAt: true, rateLimitBookDetail: true, rateLimitBookDownload: true, rateLimitBookRelated: true, rateLimitSearch: true }});
    
    res.json({ success: true, users: usersWithLimits });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/auth/users/:id (Only admins can edit users)
router.put('/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { username, password, role, rateLimitBookDetail, rateLimitBookDownload, rateLimitBookRelated, rateLimitSearch } = req.body as { username?: string, password?: string, role?: string, rateLimitBookDetail?: number, rateLimitBookDownload?: number, rateLimitBookRelated?: number, rateLimitSearch?: number };

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOneBy({ id });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (username) {
      // Check if new username is already taken by someone else
      const existingUser = await userRepository.findOneBy({ username });
      if (existingUser && existingUser.id !== id) {
        return res.status(409).json({ success: false, error: 'Username already in use' });
      }
      user.username = username;
    }

    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }

    if (role) {
      user.role = role;
    }

    if (rateLimitBookDetail !== undefined) {
      user.rateLimitBookDetail = rateLimitBookDetail;
    }

    if (rateLimitBookDownload !== undefined) {
      user.rateLimitBookDownload = rateLimitBookDownload;
    }

    if (rateLimitBookRelated !== undefined) {
      user.rateLimitBookRelated = rateLimitBookRelated;
    }

    if (rateLimitSearch !== undefined) {
      user.rateLimitSearch = rateLimitSearch;
    }

    await userRepository.save(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        rateLimitBookDetail: user.rateLimitBookDetail,
        rateLimitBookDownload: user.rateLimitBookDownload,
        rateLimitBookRelated: user.rateLimitBookRelated,
        rateLimitSearch: user.rateLimitSearch,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/auth/me (View own account details)
router.get('/me', authenticate, trackUsage, async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({where: { id: authReq.user.id }, select: { id: true, username: true, role: true, createdAt: true, rateLimitBookDetail: true, rateLimitBookDownload: true, rateLimitBookRelated: true, rateLimitSearch: true }});

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Get current usage progress for this user
    const usageProgress = getUserRateLimitProgress(authReq.user.id);

    res.json({
      success: true,
      user,
      rateLimits: {
        bookDetail: {
          limit: user.rateLimitBookDetail === -1 ? null : user.rateLimitBookDetail,
          current: usageProgress.bookDetail,
        },
        bookDownload: {
          limit: user.rateLimitBookDownload === -1 ? null : user.rateLimitBookDownload,
          current: usageProgress.bookDownload,
        },
        bookRelated: {
          limit: user.rateLimitBookRelated === -1 ? null : user.rateLimitBookRelated,
          current: usageProgress.bookRelated,
        },
        search: {
          limit: user.rateLimitSearch === -1 ? null : user.rateLimitSearch,
          current: usageProgress.search,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/auth/users/:id/usage (Admin only - view API usage of a specific account)
router.get('/users/:id/usage', authenticate, requireRole('admin'), trackUsage, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // Verify user exists
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({where: { id }, select: { id: true, username: true, role: true, createdAt: true, rateLimitBookDetail: true, rateLimitBookDownload: true, rateLimitBookRelated: true, rateLimitSearch: true }});

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const usageRepository = AppDataSource.getRepository(ApiUsage);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    const [records, total] = await usageRepository.findAndCount({where: { userId: id }, order: { createdAt: 'DESC' }, take: limit, skip: offset});

    // Get current usage progress for this user
    const usageProgress = getUserRateLimitProgress(id);

    res.json({
      success: true,
      user,
      rateLimits: {
        bookDetail: {
          limit: user.rateLimitBookDetail === -1 ? null : user.rateLimitBookDetail,
          current: usageProgress.bookDetail,
        },
        bookDownload: {
          limit: user.rateLimitBookDownload === -1 ? null : user.rateLimitBookDownload,
          current: usageProgress.bookDownload,
        },
        bookRelated: {
          limit: user.rateLimitBookRelated === -1 ? null : user.rateLimitBookRelated,
          current: usageProgress.bookRelated,
        },
        search: {
          limit: user.rateLimitSearch === -1 ? null : user.rateLimitSearch,
          current: usageProgress.search,
        },
      },
      usage: {
        total,
        limit,
        offset,
        records
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ── API Key Management ──────────────────────────────────────────────────────

/**
 * Generate a new API key.
 * POST /api/auth/api-keys
 */
router.post('/api-keys', authenticate, async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const { name } = req.body as { name?: string };

    const rawKey = 'aa_sk_' + crypto.randomBytes(24).toString('base64url');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12) + '...';

    const apiKeyRepo = AppDataSource.getRepository(ApiKey);
    const apiKey = apiKeyRepo.create({
      userId: authReq.user.id,
      keyHash,
      keyPrefix,
      name: name || null,
    });
    await apiKeyRepo.save(apiKey);

    res.status(201).json({
      success: true,
      apiKey: {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey, // Shown once on creation
        keyPrefix: apiKey.keyPrefix,
        createdAt: apiKey.createdAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * List own API keys (metadata only — never expose hash or full key).
 * GET /api/auth/api-keys
 */
router.get('/api-keys', authenticate, async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const apiKeyRepo = AppDataSource.getRepository(ApiKey);
    const keys = await apiKeyRepo.find({
      where: { userId: authReq.user.id } as any,
      select: { id: true, keyPrefix: true, name: true, lastUsedAt: true, createdAt: true, revokedAt: true } as any,
      order: { createdAt: 'DESC' } as any,
    });

    res.json({ success: true, apiKeys: keys });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Revoke one of own API keys.
 * DELETE /api/auth/api-keys/:id
 */
router.delete('/api-keys/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const authReq = req as any;
    const { id } = req.params;

    const apiKeyRepo = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepo.findOne({
      where: { id, userId: authReq.user.id } as any,
    });

    if (!apiKey) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    if (apiKey.revokedAt) {
      return res.status(400).json({ success: false, error: 'API key is already revoked' });
    }

    apiKey.revokedAt = new Date();
    await apiKeyRepo.save(apiKey);

    // Invalidate cache entry
    invalidateCachedKey(apiKey.keyHash);

    res.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * Admin: list any user's API keys.
 * GET /api/auth/users/:id/api-keys
 */
router.get('/users/:id/api-keys', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify user exists
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { id } as any });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const apiKeyRepo = AppDataSource.getRepository(ApiKey);
    const keys = await apiKeyRepo.find({
      where: { userId: id } as any,
      select: { id: true, keyPrefix: true, name: true, lastUsedAt: true, createdAt: true, revokedAt: true } as any,
      order: { createdAt: 'DESC' } as any,
    });

    res.json({ success: true, apiKeys: keys });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
