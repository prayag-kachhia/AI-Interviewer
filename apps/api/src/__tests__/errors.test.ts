import express from 'express';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app, { errorHandler } from '../server';
import { AppError, NotFoundError } from '../errors';
import { FeedbackRetryConflictError } from '../services/feedback.service';
import { InterviewerTimeoutError } from '../services/interviewer.service';
import {
  InvalidRoleError,
  SessionEndedError,
  TurnTextTooLongError,
} from '../services/session.service';
import { VoiceProviderTimeoutError } from '../services/voice-provider.service';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
}));

vi.mock('../db', () => ({ default: {} }));

describe('API error responses', () => {
  it('given an unknown /api path, then a JSON 404', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: 'Not found' });
  });

  it('given a malformed JSON body, then a JSON 400 without a stack trace', async () => {
    const res = await request(app)
      .post('/api/sessions')
      .set('Content-Type', 'application/json')
      .send('{"roleId": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Invalid request' });
    expect(res.text).not.toContain('SyntaxError');
  });

  it.each<[string, AppError, number]>([
    ['NotFoundError', new NotFoundError(), 404],
    ['InvalidRoleError', new InvalidRoleError('Unknown role id: foo'), 400],
    ['TurnTextTooLongError', new TurnTextTooLongError(), 400],
    ['SessionEndedError', new SessionEndedError(), 409],
    ['FeedbackRetryConflictError', new FeedbackRetryConflictError(), 409],
    ['VoiceProviderTimeoutError', new VoiceProviderTimeoutError(), 503],
    ['InterviewerTimeoutError', new InterviewerTimeoutError(), 503],
  ])('maps %s to HTTP %d with its message', async (_label, error, expectedStatus) => {
    expect(error.status).toBe(expectedStatus);

    const testApp = express();
    testApp.get('/boom', async () => {
      throw error;
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/boom');

    expect(res.status).toBe(expectedStatus);
    expect(res.body).toEqual({ success: false, message: error.message });
  });

  it('returns 500 without leaking internal error details for unexpected errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testApp = express();
    testApp.get('/crash', async () => {
      throw new Error('secret database connection string');
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/crash');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Internal server error' });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
