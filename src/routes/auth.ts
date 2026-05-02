import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../db';
import { User } from '../entities/User';
import { config } from '../config';
import { authenticate, requireRole } from '../middleware/auth';

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
        role: user.role
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
    });

    await userRepository.save(user);

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
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
    const users = await userRepository.find({
      select: ['id', 'username', 'role', 'createdAt'] // Exclude password
    });
    
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PUT /api/auth/users/:id (Only admins can edit users)
router.put('/users/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { username, password, role } = req.body as { username?: string, password?: string, role?: string };

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

    await userRepository.save(user);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
