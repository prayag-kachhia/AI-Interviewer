import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../db';
import { isAdminEmail, isUserEmailConfirmed } from '../services/admin.service';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Authorization middleware for admin-only endpoints (FR-32, Issue #201).
 *
 * Enforces strict 404 responses for:
 * - Unauthenticated requests (no token, malformed token, invalid or expired token)
 * - Users with unconfirmed/unverified email addresses
 * - Authenticated users whose verified email is not in the server-side ADMIN_EMAILS configuration
 * - Any caller when ADMIN_EMAILS is unset or empty
 *
 * Returns 404 (Not Found) rather than 401 or 403 to prevent endpoint enumeration (FR-27).
 */
export const adminOnly = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user || !user.email) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    const isConfirmed = isUserEmailConfirmed(user);
    const email = user.email.trim().toLowerCase();

    // An unverified account must never receive admin privileges.
    if (!isConfirmed || !isAdminEmail(email)) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }

    let localUser = await prisma.user.findUnique({
      where: { supabaseUserId: user.id },
    });
    if (!localUser) {
      localUser = await prisma.user.findUnique({
        where: { email },
      });
    }

    req.user = {
      id: localUser?.id ?? user.id,
      supabaseUserId: user.id,
      email,
      name:
        localUser?.name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        'Admin',
      isEmailConfirmed: true,
    };

    next();
  } catch (error) {
    res.status(404).json({ success: false, message: 'Not found' });
  }
};
