import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getEnrichedImprovementPlan } from '../services/insights.service';
import { NotFoundError } from '../errors';

const router = Router();

// GET /api/insights
// Returns the improvement plan for the authenticated candidate.
// Returns 404 if no plan exists or if another user's plan is requested (FR-27).
router.get('/', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const requestedUserId = req.query.userId as string | undefined;

  if (requestedUserId && requestedUserId !== userId) {
    throw new NotFoundError('Improvement plan not found');
  }

  const plan = await getEnrichedImprovementPlan(userId);
  if (!plan) {
    throw new NotFoundError('Improvement plan not found');
  }

  res.status(200).json({
    success: true,
    data: plan,
  });
});

// GET /api/insights/:userId
// Returns 404 for another user's resource (FR-27).
router.get('/:userId', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const requestedUserId = req.params.userId;

  if (requestedUserId !== userId) {
    throw new NotFoundError('Improvement plan not found');
  }

  const plan = await getEnrichedImprovementPlan(userId);
  if (!plan) {
    throw new NotFoundError('Improvement plan not found');
  }

  res.status(200).json({
    success: true,
    data: plan,
  });
});

export default router;
