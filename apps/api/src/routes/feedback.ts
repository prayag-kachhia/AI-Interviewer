import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getFeedbackForSession,
  retryFeedbackEvaluation,
  FeedbackRetryConflictError,
} from '../services/feedback.service';
import { NotFoundError } from '../errors';

const router = Router();

// Mounted under /api/sessions, next to the sessions router.
// GET /api/sessions/:id/feedback  (the results screen polls this)
router.get('/:id/feedback', authenticate, async (req, res) => {
  try {
    const feedback = await getFeedbackForSession(req.params.id as string, req.user!.id);
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Get feedback error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch feedback' });
  }
});

// POST /api/sessions/:id/feedback/retry
router.post('/:id/feedback/retry', authenticate, async (req, res) => {
  try {
    const feedback = await retryFeedbackEvaluation(req.params.id as string, req.user!.id);
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof FeedbackRetryConflictError) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    console.error('Retry feedback error:', error);
    res.status(500).json({ success: false, message: 'Failed to retry feedback evaluation' });
  }
});

export default router;
