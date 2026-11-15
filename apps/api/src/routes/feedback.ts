import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getFeedbackForSession, retryFeedbackEvaluation } from '../services/feedback.service';

const router = Router();

// Mounted under /api/sessions, next to the sessions router.
// GET /api/sessions/:id/feedback  (the results screen polls this)
router.get('/:id/feedback', authenticate, async (req, res) => {
  const feedback = await getFeedbackForSession(req.params.id as string, req.user!.id);
  res.status(200).json({ success: true, data: feedback });
});

// POST /api/sessions/:id/feedback/retry
router.post('/:id/feedback/retry', authenticate, async (req, res) => {
  const feedback = await retryFeedbackEvaluation(req.params.id as string, req.user!.id);
  res.status(200).json({ success: true, data: feedback });
});

export default router;
