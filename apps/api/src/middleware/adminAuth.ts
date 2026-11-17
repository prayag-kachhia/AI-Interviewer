import { Request, Response, NextFunction } from 'express';
import { createAuthMiddleware } from './auth';
import { isAdminEmail } from '../services/admin.service';

/**
 * Stage 1: Authenticate the admin request using the canonical authentication mechanism,
 * responding with HTTP 404 on failure to prevent endpoint enumeration (FR-27).
 * Reuses the existing authentication implementation without repeating token verification.
 */
export const adminAuthenticate = createAuthMiddleware({
  unauthorizedStatus: 404,
  unauthorizedMessage: 'Not found',
});

/**
 * Stage 2: Authorize that the authenticated user's email is confirmed
 * and included in the server-side ADMIN_EMAILS configuration.
 * Kept separate from authentication.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const user = req.user;
  if (!user || !user.isEmailConfirmed || !isAdminEmail(user.email)) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }
  next();
};

/**
 * Combined admin authorization middleware for admin-only endpoints (FR-32, Issue #201).
 * Reuses the canonical authentication mechanism without duplicating token verification,
 * keeps authorization separate, and guarantees HTTP 404 for all unauthorized requests.
 */
export const adminOnly = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  adminAuthenticate(req, res, (err) => {
    if (err) return next(err);
    requireAdmin(req, res, next);
  });
};
