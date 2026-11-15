import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getEnrichedImprovementPlan, updateRoadmapProgress } from '../services/insights.service';
import { NotFoundError } from '../errors';
import { UpdateRoadmapProgressInput } from '@interview/contracts';

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

// PATCH /api/insights/progress
// Marks roadmap action items done (or undone) for the authenticated candidate (V-6).
// Returns 404 if no plan exists, if action is not found, or for another user (FR-27).
router.patch('/progress', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const requestedUserId = (req.body?.userId || req.query?.userId) as string | undefined;

  if (requestedUserId && requestedUserId !== userId) {
    throw new NotFoundError('Improvement plan not found');
  }

  const parsed = UpdateRoadmapProgressInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      success: false,
      message: `${issue.path.join('.') || 'input'}: ${issue.message}`,
    });
    return;
  }

  const actionId = (parsed.data.actionId || parsed.data.id || parsed.data.itemId)!;
  const completed = parsed.data.completed;

  const plan = await updateRoadmapProgress(userId, actionId, completed);

  res.status(200).json({
    success: true,
    data: plan,
  });
});

// PATCH /api/insights/progress/:actionId
router.patch('/progress/:actionId', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const requestedUserId = (req.body?.userId || req.query?.userId) as string | undefined;

  if (requestedUserId && requestedUserId !== userId) {
    throw new NotFoundError('Improvement plan not found');
  }

  const actionId = Array.isArray(req.params.actionId) ? req.params.actionId[0] : req.params.actionId;
  const completed = typeof req.body?.completed === 'boolean' ? req.body.completed : true;

  const plan = await updateRoadmapProgress(userId, actionId, completed);

  res.status(200).json({
    success: true,
    data: plan,
  });
});

export default router;
