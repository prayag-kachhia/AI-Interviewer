import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getFeedbackForSession } from '../services/feedback.service';
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

export default router;
