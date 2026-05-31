import { Response, NextFunction } from 'express';
import { AppDataSource } from '../db';
import { ApiUsage } from '../entities/ApiUsage';
import { AuthRequest } from './auth';

export const trackUsage = (req: AuthRequest, res: Response, next: NextFunction) => {
  // Track the response after it finishes
  res.on('finish', () => {
    if (req.user) {
      const usage = new ApiUsage();
      usage.userId = req.user.id;
      usage.endpoint = req.originalUrl || req.url;
      usage.method = req.method;
      usage.ip = req.ip || req.socket.remoteAddress || '';
      
      AppDataSource.getRepository(ApiUsage)
        .save(usage)
        .catch((err) => {
          console.error('Failed to track API usage:', err);
        });
    }
  });

  next();
};
