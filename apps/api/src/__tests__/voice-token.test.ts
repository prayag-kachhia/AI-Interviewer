import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import { mintVoiceToken, VoiceProviderTimeoutError } from '../services/voice-provider.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn() },
  },
}));

// Route tests never reach the provider; the real function is tested below.
vi.mock('../services/voice-provider.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/voice-provider.service')>();
  return { ...actual, mintVoiceToken: vi.fn() };
});

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

const AUTH_USER = {
  id: 'user-1',
  supabaseUserId: 'supabase-user-1',
  email: 'vishwa@example.com',
  name: 'Vishwa',
};

const OWN_LIVE_SESSION = {
  id: 'sess-1',
  userId: AUTH_USER.id,
  role: 'software-engineer',
  status: 'LIVE',
  startedAt: new Date(),
  endedAt: null,
  createdAt: new Date(),
};

describe('LS3 — POST /api/sessions/:id/voice-token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __getUserMock.mockResolvedValue({
      data: { user: { id: AUTH_USER.supabaseUserId, email: AUTH_USER.email } },
      error: null,
    });
    (prisma.user.findUnique as any).mockResolvedValue({ ...AUTH_USER, passwordHash: 'x' });
  });

  it("given the candidate's own session, when a token is requested, then a short-lived token comes back", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(OWN_LIVE_SESSION);
    vi.mocked(mintVoiceToken).mockResolvedValueOnce('auth_tokens/ephemeral-123');

    const res = await request(app)
      .post('/api/sessions/sess-1/voice-token')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { token: 'auth_tokens/ephemeral-123' } });
    expect(prisma.session.findFirst).toHaveBeenCalledWith({
      where: { id: 'sess-1', userId: AUTH_USER.id },
    });
  });

  it("given another candidate's session, then the API returns 404 (FR-27) and mints nothing", async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/sessions/someone-elses/voice-token')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(404);
    expect(mintVoiceToken).not.toHaveBeenCalled();
  });

  it('given an ended session, then the API returns 409 and mints nothing', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce({ ...OWN_LIVE_SESSION, status: 'ENDED' });

    const res = await request(app)
      .post('/api/sessions/sess-1/voice-token')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(409);
    expect(mintVoiceToken).not.toHaveBeenCalled();
  });

  it('given no token, then 401', async () => {
    const res = await request(app).post('/api/sessions/sess-1/voice-token');
    expect(res.status).toBe(401);
  });

  it('given the provider fails, then the response carries no provider details (NFR-09)', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(OWN_LIVE_SESSION);
    vi.mocked(mintVoiceToken).mockRejectedValueOnce(
      new Error('Voice provider token request failed with status 403: API key AIzaSECRET invalid')
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/sessions/sess-1/voice-token')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('AIzaSECRET');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('given the provider times out, then the API answers 503 with a retry message', async () => {
    (prisma.session.findFirst as any).mockResolvedValueOnce(OWN_LIVE_SESSION);
    vi.mocked(mintVoiceToken).mockRejectedValueOnce(new VoiceProviderTimeoutError());

    const res = await request(app)
      .post('/api/sessions/sess-1/voice-token')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      message: 'Voice service unavailable, try again',
    });
  });
});

describe('LS3 — mintVoiceToken (voice provider client)', () => {
  it('sends the key only in the request header and returns the ephemeral token name', async () => {
    const { mintVoiceToken: realMint } = await vi.importActual<
      typeof import('../services/voice-provider.service')
    >('../services/voice-provider.service');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ name: 'auth_tokens/abc' })));

    const token = await realMint({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    expect(token).toBe('auth_tokens/abc');
    expect(token).not.toContain('test-key');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(JSON.parse(init.body as string).uses).toBe(1);
  });

  it('throws when no API key is configured', async () => {
    const { mintVoiceToken: realMint } = await vi.importActual<
      typeof import('../services/voice-provider.service')
    >('../services/voice-provider.service');
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await expect(realMint({ fetchFn: vi.fn() as unknown as typeof fetch })).rejects.toThrow(
      'GEMINI_API_KEY is not configured'
    );
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  });

  it('aborts and throws VoiceProviderTimeoutError when fetch times out', async () => {
    const { mintVoiceToken: realMint, VoiceProviderTimeoutError: RealTimeoutError } =
      await vi.importActual<typeof import('../services/voice-provider.service')>(
        '../services/voice-provider.service'
      );

    const hangingFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'TimeoutError';
            reject(err);
          });
        }
      });
    });

    await expect(
      realMint({
        apiKey: 'test-key',
        fetchFn: hangingFetch as unknown as typeof fetch,
        timeoutMs: 10,
      })
    ).rejects.toThrow(RealTimeoutError);
  });

  it('passes AbortSignal to the fetch call and uses the v1beta endpoint', async () => {
    const { mintVoiceToken: realMint } = await vi.importActual<
      typeof import('../services/voice-provider.service')
    >('../services/voice-provider.service');
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ name: 'auth_tokens/abc' })));

    await realMint({ apiKey: 'test-key', fetchFn: fetchFn as unknown as typeof fetch });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    expect(init.signal).toBeDefined();
  });
});
