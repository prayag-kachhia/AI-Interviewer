import { Request, Response } from 'express';
import {
  createSession,
  getOwnedSession,
  listTurns,
  addTurn,
  endSession,
  InvalidRoleError,
  InvalidTimestampError,
  SessionEndedError,
} from '../services/session.service';
import { mintVoiceToken } from '../services/voice-provider.service';
import { NotFoundError } from '../utils/resource';
import { RoleList, ROLES, VoiceToken } from '@interview/contracts';

export const getRoles = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: RoleList.parse(ROLES) });
};

// POST /api/sessions
export const postSession = async (req: Request, res: Response): Promise<void> => {
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
};

// GET /api/sessions/:id  (session + its turns, for loading/resuming the interview screen)
export const getSessionById = async (req: Request, res: Response): Promise<void> => {
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
};

// GET /api/sessions/:id/turns
export const getTurns = async (req: Request, res: Response): Promise<void> => {
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
};

// POST /api/sessions/:id/turns
export const postTurn = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    const { speaker, text, timestampSec } = req.body ?? {};

    if (speaker !== 'AI' && speaker !== 'CANDIDATE') {
      res.status(400).json({ success: false, message: 'speaker must be "AI" or "CANDIDATE"' });
      return;
    }
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ success: false, message: 'text is required' });
      return;
    }
    if (typeof timestampSec !== 'number' || !Number.isFinite(timestampSec) || timestampSec < 0) {
      res.status(400).json({ success: false, message: 'timestampSec must be a non-negative number' });
      return;
    }

    const turn = await addTurn(id, userId, speaker, text.trim(), timestampSec);
    res.status(201).json({ success: true, data: turn });
  } catch (error) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ success: false, message: 'Resource not found' });
      return;
    }
    if (error instanceof InvalidTimestampError) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    if (error instanceof SessionEndedError) {
      res.status(409).json({ success: false, message: error.message });
      return;
    }
    console.error('Post turn error:', error);
    res.status(500).json({ success: false, message: 'Failed to store turn' });
  }
};

// POST /api/sessions/:id/end
export const postEndSession = async (req: Request, res: Response): Promise<void> => {
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
};

// POST /api/sessions/:id/voice-token
export const postVoiceToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const session = await getOwnedSession(id, userId);
    if (session.status !== 'LIVE') {
      throw new SessionEndedError();
    }

    const token = await mintVoiceToken();
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
    // Provider errors can carry provider details; log them, never return them.
    console.error('Voice token error:', error);
    res.status(500).json({ success: false, message: 'Failed to start the voice session' });
  }
};
