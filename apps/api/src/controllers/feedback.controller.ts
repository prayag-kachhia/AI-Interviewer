import { Request, Response } from 'express';
import {
  getFeedbackForSession,
  retryFeedbackForSession,
  FeedbackNotFailedError,
} from '../services/feedback.service';
import { NotFoundError } from '../utils/resource';

// GET /api/sessions/:id/feedback  (the results screen polls this)
export const getFeedback = async (req: Request, res: Response): Promise<void> => {
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
};

// POST /api/sessions/:id/feedback/retry
export const postRetryFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    await retryFeedbackForSession(req.params.id as string, req.user!.id);
    res.status(200).json({ success: true, message: 'Feedback retry initiated' });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof FeedbackNotFailedError) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('Retry feedback error:', error);
    res.status(500).json({ success: false, message: 'Failed to retry feedback' });
  }
};
