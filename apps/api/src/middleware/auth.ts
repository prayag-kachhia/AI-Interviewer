
import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import prisma from '../db';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export interface AuthenticateOptions {
  unauthorizedStatus?: number;
  unauthorizedMessage?: string;
}

/**
 * Creates an authentication middleware instance.
 *
 * Configurable with custom unauthorized status (e.g. 404 for admin endpoints to prevent
 * enumeration per FR-27, while defaulting to 401 for standard protected routes).
 */
export const createAuthMiddleware = (options: AuthenticateOptions = {}) => {
  const status = options.unauthorizedStatus ?? 401;
  const defaultMessage = status === 404 ? 'Not found' : 'Authentication required';
  const invalidMessage = status === 404 ? 'Not found' : 'Invalid or expired token';
  const noEmailMessage = status === 404 ? 'Not found' : 'Authenticated user has no email address';
  const conflictMessage = status === 404 ? 'Not found' : 'This email is linked to another authentication account';

  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(status).json({ success: false, message: options.unauthorizedMessage || defaultMessage });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(status).json({ success: false, message: options.unauthorizedMessage || defaultMessage });
      return;
    }

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        res.status(status).json({
          success: false,
          message: options.unauthorizedMessage || invalidMessage,
        });
        return;
      }

      const email = user.email?.trim().toLowerCase();
      if (!email) {
        res.status(status).json({
          success: false,
          message: options.unauthorizedMessage || noEmailMessage,
        });
        return;
      }

      // Link the Supabase identity to the application's users table.
      let localUser = await prisma.user.findUnique({
        where: { supabaseUserId: user.id },
      });

      if (!localUser) {
        const existingEmailUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingEmailUser) {
          if (
            existingEmailUser.supabaseUserId &&
            existingEmailUser.supabaseUserId !== user.id
          ) {
            res.status(status).json({
              success: false,
              message: options.unauthorizedMessage || conflictMessage,
            });
            return;
          }

          localUser = await prisma.user.update({
            where: { id: existingEmailUser.id },
            data: { supabaseUserId: user.id },
          });
        } else {
          localUser = await prisma.user.create({
            data: {
              supabaseUserId: user.id,
              email,
              name:
                user.user_metadata?.full_name ||
                user.user_metadata?.name ||
                'Candidate',
            },
          });
        }
      }

      req.user = {
        id: localUser?.id ?? user.id,
        supabaseUserId: localUser?.supabaseUserId ?? user.id,
        email: localUser?.email ?? email,
        name:
          localUser?.name ||
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          'Candidate',
        isEmailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
      };

      next();
    } catch (error) {
      console.error('Supabase authentication error:', error);
      res.status(status).json({
        success: false,
        message: options.unauthorizedMessage || invalidMessage,
      });
    }
  };
};

/**
 * Authenticate every protected API request with the Supabase access token
 * supplied by the browser as: Authorization: Bearer <access_token>.
 *
 * No application-generated/local tokens are accepted here. Supabase Auth is
 * the single authentication authority for the application.
 */
export const authenticate = createAuthMiddleware();
