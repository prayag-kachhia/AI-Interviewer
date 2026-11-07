import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getFeedback, postRetryFeedback } from '../controllers/feedback.controller';

const router = Router();

// Mounted under /api/sessions, next to the sessions router.
router.get('/:id/feedback', authenticate, getFeedback);
router.post('/:id/feedback/retry', authenticate, postRetryFeedback);

export default router;
