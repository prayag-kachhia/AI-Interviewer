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
  SessionEndedError,
} from '../services/session.service';
import { mintVoiceToken } from '../services/voice-provider.service';
import { briefingFor } from '../services/briefing.service';
import { generateNextQuestion } from '../services/interviewer.service';
import { CreateSessionInput, RoleList, ROLES, VoiceToken } from '@interview/contracts';

const router = Router();

// All session routes require a signed-in candidate.
router.get('/roles', authenticate, async (_req, res) => {
  res.status(200).json({ success: true, data: RoleList.parse(ROLES) });
});

// POST /api/sessions
router.post('/', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const parsed = CreateSessionInput.safeParse(req.body ?? {});

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ success: false, message: `${issue.path.join('.') || 'input'}: ${issue.message}` });
    return;
  }

  const session = await createSession(userId, parsed.data);
  res.status(201).json({ success: true, data: session });
});

// GET /api/sessions (list sessions for authenticated user)
router.get('/', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const sessions = await listSessions(userId);
  res.status(200).json({ success: true, data: sessions });
});

// GET /api/sessions/:id  (session + its turns, for loading/resuming the interview screen)
router.get('/:id', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const session = await getOwnedSession(id, userId);
  const turns = await listTurns(id, userId);

  res.status(200).json({ success: true, data: { ...session, turns } });
});

// GET /api/sessions/:id/turns
router.get('/:id/turns', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const turns = await listTurns(id, userId);
  res.status(200).json({ success: true, data: turns });
});

// POST /api/sessions/:id/turns
router.post('/:id/turns', authenticate, async (req, res) => {
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
});

// POST /api/sessions/:id/end
router.post('/:id/end', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const session = await endSession(id, userId);
  res.status(200).json({ success: true, data: session });
});

// POST /api/sessions/:id/voice-token
router.post('/:id/voice-token', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const session = await getOwnedSession(id, userId);
  if (session.status !== 'LIVE') {
    throw new SessionEndedError();
  }

  const briefing = await briefingFor(session);

  const token = await mintVoiceToken({ briefing });
  res.status(200).json({ success: true, data: VoiceToken.parse({ token }) });
});

// POST /api/sessions/:id/next-question
router.post('/:id/next-question', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const turn = await generateNextQuestion(id, userId);
  res.status(200).json({ success: true, data: turn });
});

// DELETE /api/sessions/:id
router.delete('/:id', authenticate, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  await deleteSession(id, userId);
  res.status(200).json({ success: true, message: 'Session deleted successfully' });
});

export default router;
