import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import crypto from 'crypto';
import { AppDataSource } from '../db';
import { ApiKey } from '../entities/ApiKey';
import { getCachedUser, setCachedUser } from '../apiKeyCache';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    role: string;
  };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // ── API Key authentication ──────────────────────────────────────────────
  if (token.startsWith('aa_sk_')) {
    return authenticateApiKey(token, req, res, next);
  }

  // ── JWT authentication ─────────────────────────────────────────────────
  return authenticateJwt(token, req, res, next);
};

/**
 * Authenticate using an API key (aa_sk_...).
 */
async function authenticateApiKey(rawKey: string, req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    // Check in-memory cache first
    const cached = getCachedUser(keyHash);
    if (cached) {
      req.user = cached;
      touchLastUsed(keyHash);
      return next();
    }

    // DB lookup: find the API key joined with user data
    const apiKeyRepo = AppDataSource.getRepository(ApiKey);
    const apiKey = await apiKeyRepo.findOne({
      where: { keyHash },
      relations: { user: true },
    });

    if (!apiKey) {
      return res.status(403).json({ success: false, error: 'Forbidden: Invalid API key' });
    }

    if (apiKey.revokedAt) {
      return res.status(403).json({ success: false, error: 'Forbidden: API key has been revoked' });
    }

    const user = {
      id: apiKey.userId,
      username: apiKey.user.username,
      role: apiKey.user.role,
    };

    setCachedUser(keyHash, user);
    req.user = user;
    touchLastUsed(keyHash);

    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error during authentication' });
  }
}

/**
 * Authenticate using a JWT token.
 */
function authenticateJwt(token: string, req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret) as { id: string; username: string; role: string };
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Forbidden: Invalid token' });
  }
}

/**
 * Non-blocking update of last_used_at.
 */
function touchLastUsed(keyHash: string): void {
  AppDataSource.getRepository(ApiKey)
    .createQueryBuilder()
    .update(ApiKey)
    .set({ lastUsedAt: new Date() })
    .where('keyHash = :keyHash', { keyHash })
    .execute()
    .catch(() => {});
}

export const requireRole = (role: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Not authenticated' });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ success: false, error: `Forbidden: Requires ${role} role` });
    }

    next();
  };
};
