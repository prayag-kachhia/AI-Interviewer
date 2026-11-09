import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createSession,
  getOwnedSession,
  listSessions,
  listTurns,
  addTurn,
  endSession,
  deleteSession,
  InvalidRoleError,
  InvalidTimestampError,
  SessionEndedError,
} from '../services/session.service';
import { mintVoiceToken, VoiceProviderTimeoutError } from '../services/voice-provider.service';
import { briefingFor } from '../services/briefing.service';
import { generateNextQuestion, InterviewerTimeoutError } from '../services/interviewer.service';
import { NotFoundError } from '../errors';
import { RoleList, ROLES, VoiceToken } from '@interview/contracts';

const router = Router();

// All session routes require a signed-in candidate.
router.get('/roles', authenticate, async (_req, res) => {
  res.status(200).json({ success: true, data: RoleList.parse(ROLES) });
});

// POST /api/sessions
router.post('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { roleId } = req.body ?? {};

    if (!roleId || typeof roleId !== 'string') {
      res.status(400).json({ success: false, message: 'roleId is required' });
      return;
    }

    const session = await createSession(userId, roleId);
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    if (error instanceof InvalidRoleError) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    console.error('Create session error:', error);
    res.status(500).json({ success: false, message: 'Failed to create session' });
  }
});

// GET /api/sessions (list sessions for authenticated user)
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const sessions = await listSessions(userId);
    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
  }
});

// GET /api/sessions/:id  (session + its turns, for loading/resuming the interview screen)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const session = await getOwnedSession(id, userId);
    const turns = await listTurns(id, userId);

    res.status(200).json({ success: true, data: { ...session, turns } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Get session error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
});

// GET /api/sessions/:id/turns
router.get('/:id/turns', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const turns = await listTurns(id, userId);
    res.status(200).json({ success: true, data: turns });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Get turns error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch turns' });
  }
});

// POST /api/sessions/:id/turns
router.post('/:id/turns', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { speaker, text } = req.body ?? {};

    if (speaker !== 'AI' && speaker !== 'CANDIDATE') {
      res.status(400).json({ success: false, message: 'speaker must be "AI" or "CANDIDATE"' });
      return;
    }
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ success: false, message: 'text is required' });
      return;
    }

    const turn = await addTurn(id, userId, speaker, text.trim());
    res.status(201).json({ success: true, data: turn });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof SessionEndedError) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    console.error('Post turn error:', error);
    res.status(500).json({ success: false, message: 'Failed to store turn' });
  }
});

// POST /api/sessions/:id/end
router.post('/:id/end', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const session = await endSession(id, userId);
    res.status(200).json({ success: true, data: session });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('End session error:', error);
    res.status(500).json({ success: false, message: 'Failed to end session' });
  }
});

// POST /api/sessions/:id/voice-token
router.post('/:id/voice-token', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const session = await getOwnedSession(id, userId);
    if (session.status !== 'LIVE') {
      throw new SessionEndedError();
    }

    const briefing = await briefingFor(session);

    const token = await mintVoiceToken({ briefing });
    res.status(200).json({ success: true, data: VoiceToken.parse({ token }) });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof SessionEndedError) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    if (error instanceof VoiceProviderTimeoutError) {
      res.status(503).json({ success: false, message: 'Voice service unavailable, try again' });
      return;
    }
    // Provider errors can carry provider details; log them, never return them.
    console.error('Voice token error:', error);
    res.status(500).json({ success: false, message: 'Failed to start the voice session' });
  }
});

// POST /api/sessions/:id/next-question
router.post('/:id/next-question', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const turn = await generateNextQuestion(id, userId);
    res.status(200).json({ success: true, data: turn });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof SessionEndedError) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    if (error instanceof InterviewerTimeoutError) {
      res.status(503).json({ success: false, message: error.message });
      return;
    }
    console.error('Next question error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate next interview question' });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    await deleteSession(id, userId);
    res.status(200).json({ success: true, message: 'Session deleted successfully' });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    console.error('Delete session error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete session' });
  }
});

export default router;
