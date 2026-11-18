import { Router, Request, Response, NextFunction } from 'express';
import { adminOnly } from '../middleware/adminAuth';
import { getPlatformStats } from '../services/admin.service';

const router = Router();

/**
 * GET /api/admin/stats
 * Returns platform statistics for authorized administrators (FR-32, Issue #201).
 * Callers who are not authorized administrators receive HTTP 404.
 */
router.get('/stats', adminOnly, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getPlatformStats();
    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
