import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
      }
    })),
    __getUserMock: getUserMock
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    resume: {
      findFirst: vi.fn(),
    }
  }
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

describe('Authentication and Resource Ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Authentication Middleware (Supabase Bearer tokens)', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const res = await request(app).get('/api/resume/latest');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required');
    });

    it('returns 401 when Authorization header is malformed (e.g. Basic)', async () => {
      const res = await request(app).get('/api/resume/latest').set('Authorization', 'Basic abc');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required');
    });

    it('returns 401 when Authorization header is malformed (e.g. only Bearer)', async () => {
      const res = await request(app).get('/api/resume/latest').set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Authentication required');
    });

    it('returns 401 when token is invalid or expired', async () => {
      __getUserMock.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Invalid token' } });
      const res = await request(app).get('/api/resume/latest').set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid or expired token');
    });

    it('proceeds and injects user ID when token is valid', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: { id: 'supabase-1', email: 'test@test.com' } },
        error: null
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'local-1', supabaseUserId: 'supabase-1', email: 'test@test.com', name: 'Test'
      });
      (prisma.resume.findFirst as any).mockResolvedValueOnce({
        id: 'resume-1',
        userId: 'local-1',
        fileName: 'test.pdf',
        createdAt: new Date(),
        parsedProfile: JSON.stringify({ name: 'Test' })
      });

      const res = await request(app).get('/api/resume/latest').set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(200);
      expect(res.body.data.resumeId).toBe('resume-1');
      // Verify findFirst was called with the correct local userId
      expect(prisma.resume.findFirst).toHaveBeenCalledWith({
        where: { userId: 'local-1' },
        orderBy: { createdAt: 'desc' }
      });
    });
  });

  describe('Resource Ownership Helper', () => {
    it('returns 200 when authenticated user requests their own resource', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: { id: 'supabase-1', email: 'test@test.com' } },
        error: null
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'local-1', supabaseUserId: 'supabase-1', email: 'test@test.com', name: 'Test'
      });
      (prisma.resume.findFirst as any).mockResolvedValueOnce({
        id: 'resume-123',
        userId: 'local-1',
        fileName: 'test.pdf',
        createdAt: new Date(),
        parsedProfile: JSON.stringify({})
      });

      const res = await request(app).get('/api/resume/resume-123').set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(200);
      // Ownership check: we query by both id and userId
      expect(prisma.resume.findFirst).toHaveBeenCalledWith({
        where: { id: 'resume-123', userId: 'local-1' }
      });
    });

    it('returns 404 when authenticated user requests a nonexistent resource', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: { id: 'supabase-1', email: 'test@test.com' } },
        error: null
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'local-1', supabaseUserId: 'supabase-1', email: 'test@test.com', name: 'Test'
      });
      // Mock db returning null (not found)
      (prisma.resume.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app).get('/api/resume/nonexistent').set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Resource not found');
    });

    it('returns 404 when authenticated user requests another user\'s resource (no 403)', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: { id: 'supabase-1', email: 'test@test.com' } },
        error: null
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'local-1', supabaseUserId: 'supabase-1', email: 'test@test.com', name: 'Test'
      });
      // Mock db returning null because the combined (id, userId) query finds nothing
      // (Even if resource exists for another user, our helper query won't find it)
      (prisma.resume.findFirst as any).mockResolvedValueOnce(null);

      const res = await request(app).get('/api/resume/others-resume').set('Authorization', 'Bearer valid-token');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Resource not found');
    });
  });
});
