import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../utils/db';
import { AuthUser } from '../types';
import { verifyLocalToken } from '../utils/token';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://dummy.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key'
);

interface LocalUserRecord {
  id: string;
  supabaseUserId?: string | null;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  // Handle local tokens
  if (token.startsWith('local_')) {
    const payload = verifyLocalToken(token);
    if (!payload || !payload.userId) {
      res.status(401).json({ success: false, message: 'Invalid or expired token' });
      return;
    }

    try {
      const localUser = await (prisma.user as any).findUnique({
        where: { id: payload.userId }
      });

      if (!localUser) {
        res.status(401).json({ success: false, message: 'User record not found' });
        return;
      }

      req.user = {
        id: localUser.id,
        supabaseUserId: localUser.supabaseUserId || null,
        email: localUser.email,
        name: localUser.name,
      };

      next();
      return;
    } catch (err) {
      res.status(401).json({ success: false, message: 'Invalid or expired token' });
      return;
    }
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({ success: false, message: 'Invalid or expired token' });
      return;
    }

    let localUser: (LocalUserRecord | null) = await (prisma.user as any).findUnique({
      where: { supabaseUserId: user.id }
    });

    if (!localUser) {
      let existingEmailUser: (LocalUserRecord | null) = null;
      if (user.email) {
        existingEmailUser = await (prisma.user as any).findUnique({
          where: { email: user.email }
        });
      }

      if (existingEmailUser && !existingEmailUser.supabaseUserId) {
        localUser = await (prisma.user as any).update({
          where: { email: user.email },
          data: { supabaseUserId: user.id }
        });
      } else if (existingEmailUser) {
        // Email exists but is mapped to another supabaseUserId (should not happen normally)
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
        return;
      } else {
        localUser = await (prisma.user as any).create({
          data: {
            supabaseUserId: user.id,
            email: user.email || `no-email-${user.id}@example.com`,
            name: user.user_metadata?.full_name || 'Candidate',
            passwordHash: 'supabase-auth',
          }
        });
      }
    }

    if (!localUser) {
      res.status(401).json({ success: false, message: 'User record not found' });
      return;
    }

    req.user = {
      id: localUser.id,
      supabaseUserId: localUser.supabaseUserId || user.id,
      email: localUser.email,
      name: localUser.name,
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};
