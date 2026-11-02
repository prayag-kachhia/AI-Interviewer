import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getRoles,
  postSession,
  getSessionById,
  getTurns,
  postTurn,
  postEndSession,
  postVoiceToken,
  deleteSessionById,
} from '../controllers/session.controller';

const router = Router();

// All session routes require a signed-in candidate.
router.get('/roles', authenticate, getRoles);
router.post('/', authenticate, postSession);
router.get('/:id', authenticate, getSessionById);
router.delete('/:id', authenticate, deleteSessionById);
router.get('/:id/turns', authenticate, getTurns);
router.post('/:id/turns', authenticate, postTurn);
router.post('/:id/end', authenticate, postEndSession);
router.post('/:id/voice-token', authenticate, postVoiceToken);

export default router;
