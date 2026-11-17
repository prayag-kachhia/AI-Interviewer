import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';
import {
  getAdminEmails,
  isAdminEmail,
  isUserEmailConfirmed,
  isVerifiedAdmin,
  getPlatformStats,
} from '../services/admin.service';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
      },
    })),
    __getUserMock: getUserMock,
  };
});

vi.mock('../db', () => ({
  default: {
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    session: {
      findMany: vi.fn(),
    },
    feedback: {
      count: vi.fn(),
    },
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock } = supabase as any;

describe('Owner Dashboard & Admin Stats API (FR-32, Issue #201)', () => {
  const originalEnv = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = 'admin@example.com, Owner@Example.com , lead@tech.org';
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalEnv;
  });

  describe('Admin email configuration & verification', () => {
    it('parses comma-separated emails, trims whitespace, and normalizes to lowercase', () => {
      process.env.ADMIN_EMAILS = '  first@admin.com , Second@Admin.com,THIRD@ADMIN.COM  ';
      const emails = getAdminEmails();
      expect(emails.size).toBe(3);
      expect(emails.has('first@admin.com')).toBe(true);
      expect(emails.has('second@admin.com')).toBe(true);
      expect(emails.has('third@admin.com')).toBe(true);
    });

    it('returns an empty set when ADMIN_EMAILS is undefined, empty, or whitespace-only', () => {
      delete process.env.ADMIN_EMAILS;
      expect(getAdminEmails().size).toBe(0);
      expect(isAdminEmail('admin@example.com')).toBe(false);

      process.env.ADMIN_EMAILS = '   ';
      expect(getAdminEmails().size).toBe(0);
      expect(isAdminEmail('admin@example.com')).toBe(false);
    });

    it('correctly matches admin emails case-insensitively and rejects non-admin emails', () => {
      expect(isAdminEmail('ADMIN@example.com')).toBe(true);
      expect(isAdminEmail('owner@example.com')).toBe(true);
      expect(isAdminEmail('lead@tech.org')).toBe(true);
      expect(isAdminEmail('hacker@example.com')).toBe(false);
      expect(isAdminEmail('')).toBe(false);
      expect(isAdminEmail(null)).toBe(false);
    });

    it('supports semicolon-separated as well as comma-separated emails', () => {
      process.env.ADMIN_EMAILS = 'lead1@company.com;lead2@company.com , lead3@company.com';
      const emails = getAdminEmails();
      expect(emails.size).toBe(3);
      expect(emails.has('lead1@company.com')).toBe(true);
      expect(emails.has('lead2@company.com')).toBe(true);
      expect(emails.has('lead3@company.com')).toBe(true);
    });

    it('validates user email confirmation via isUserEmailConfirmed and isVerifiedAdmin', () => {
      expect(isUserEmailConfirmed({ email_confirmed_at: '2026-11-17T00:00:00Z' })).toBe(true);
      expect(isUserEmailConfirmed({ confirmed_at: '2026-11-17T00:00:00Z' })).toBe(true);
      expect(isUserEmailConfirmed({ email_confirmed_at: null, confirmed_at: null })).toBe(false);
      expect(isUserEmailConfirmed(null)).toBe(false);
      expect(isUserEmailConfirmed(undefined)).toBe(false);

      expect(isVerifiedAdmin('admin@example.com', true)).toBe(true);
      expect(isVerifiedAdmin('admin@example.com', false)).toBe(false);
      expect(isVerifiedAdmin('admin@example.com', null)).toBe(false);
      expect(isVerifiedAdmin('nonadmin@example.com', true)).toBe(false);
    });
  });

  describe('getPlatformStats service', () => {
    it('calculates 14 calendar days ending on referenceDate including zero-count days', async () => {
      const fixedNow = new Date('2026-11-17T12:00:00.000Z');

      (prisma.user.count as any).mockResolvedValueOnce(42);

      // Sessions in window: 2 on 2026-11-17, 1 on 2026-11-15, 3 on 2026-11-04 (window start)
      (prisma.session.findMany as any)
        .mockResolvedValueOnce([
          { startedAt: new Date('2026-11-17T09:00:00.000Z') },
          { startedAt: new Date('2026-11-17T11:00:00.000Z') },
          { startedAt: new Date('2026-11-15T14:30:00.000Z') },
          { startedAt: new Date('2026-11-04T01:00:00.000Z') },
          { startedAt: new Date('2026-11-04T05:00:00.000Z') },
          { startedAt: new Date('2026-11-04T23:59:00.000Z') },
        ])
        .mockResolvedValueOnce([
          // scored sessions
          {
            role: 'backend-developer',
            feedback: { scores: [{ score: 4 }, { score: 5 }] }, // avg 4.5
          },
          {
            role: 'backend-developer',
            feedback: { scores: [{ score: 3 }, { score: 4 }] }, // avg 3.5 -> role avg 4.0
          },
          {
            role: 'software-engineer',
            feedback: { scores: [{ score: 5 }, { score: 5 }] }, // avg 5.0
          },
        ]);

      (prisma.feedback.count as any)
        .mockResolvedValueOnce(35) // ready
        .mockResolvedValueOnce(2); // failed

      const stats = await getPlatformStats(fixedNow);

      expect(stats.totalUsers).toBe(42);
      expect(stats.interviewsPast14Days).toHaveLength(14);
      expect(stats.interviewsPast14Days[0].date).toBe('2026-11-04');
      expect(stats.interviewsPast14Days[0].count).toBe(3);
      expect(stats.interviewsPast14Days[11].date).toBe('2026-11-15');
      expect(stats.interviewsPast14Days[11].count).toBe(1);
      expect(stats.interviewsPast14Days[13].date).toBe('2026-11-17');
      expect(stats.interviewsPast14Days[13].count).toBe(2);

      // Check an intermediate zero-count day
      const zeroDay = stats.interviewsPast14Days.find((d) => d.date === '2026-11-16');
      expect(zeroDay).toBeDefined();
      expect(zeroDay?.count).toBe(0);

      // Feedback counts
      expect(stats.feedbackCounts.ready).toBe(35);
      expect(stats.feedbackCounts.failed).toBe(2);

      // Average scores by role
      const backendRole = stats.averageScoresByRole.find((r) => r.role === 'backend-developer');
      expect(backendRole).toBeDefined();
      expect(backendRole?.averageScore).toBe(4.0);
      expect(backendRole?.sessionCount).toBe(2);

      const sweRole = stats.averageScoresByRole.find((r) => r.role === 'software-engineer');
      expect(sweRole).toBeDefined();
      expect(sweRole?.averageScore).toBe(5.0);
      expect(sweRole?.sessionCount).toBe(1);

      const daRole = stats.averageScoresByRole.find((r) => r.role === 'data-analyst');
      expect(daRole).toBeDefined();
      expect(daRole?.averageScore).toBeNull();
      expect(daRole?.sessionCount).toBe(0);
    });

    it('safely handles empty database and null/malformed feedback scores', async () => {
      (prisma.user.count as any).mockResolvedValueOnce(0);
      (prisma.session.findMany as any)
        .mockResolvedValueOnce([]) // no sessions in window
        .mockResolvedValueOnce([
          {
            role: 'backend-developer',
            feedback: { scores: null },
          },
          {
            role: 'backend-developer',
            feedback: { scores: 'not-an-array' },
          },
          {
            role: 'backend-developer',
            feedback: { scores: [{ score: 'invalid' }] },
          },
        ]);
      (prisma.feedback.count as any).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const stats = await getPlatformStats();
      expect(stats.totalUsers).toBe(0);
      expect(stats.interviewsPast14Days).toHaveLength(14);
      stats.interviewsPast14Days.forEach((day) => expect(day.count).toBe(0));
      expect(stats.feedbackCounts.ready).toBe(0);
      expect(stats.feedbackCounts.failed).toBe(0);

      const backendRole = stats.averageScoresByRole.find((r) => r.role === 'backend-developer');
      expect(backendRole?.averageScore).toBeNull();
      expect(backendRole?.sessionCount).toBe(0);
    });
  });

  describe('GET /api/admin/stats access control (FR-32)', () => {
    it('returns HTTP 404 when request has no Authorization header', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not found');
    });

    it('returns HTTP 404 when Bearer token is invalid or expired', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns HTTP 404 when authenticated user is NOT in ADMIN_EMAILS', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'candidate-user-1',
            email: 'candidate@regular.com',
            user_metadata: { full_name: 'Regular Candidate' },
          },
        },
        error: null,
      });

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer valid-user-token');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not found');
    });

    it('returns HTTP 404 when user email is in ADMIN_EMAILS but email is unconfirmed', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'unconfirmed-admin-1',
            email: 'admin@example.com',
            user_metadata: { full_name: 'Unconfirmed Admin' },
            email_confirmed_at: null,
            confirmed_at: null,
          },
        },
        error: null,
      });

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer unconfirmed-admin-token');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not found');
    });

    it('returns HTTP 404 when ADMIN_EMAILS is not configured or empty, even for a real admin', async () => {
      delete process.env.ADMIN_EMAILS;

      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'admin-user-1',
            email: 'admin@example.com',
            user_metadata: { full_name: 'Admin' },
            email_confirmed_at: '2026-11-17T00:00:00Z',
          },
        },
        error: null,
      });

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns HTTP 200 and platform statistics when user is an authorized admin with confirmed email', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'admin-user-1',
            email: 'admin@example.com',
            user_metadata: { full_name: 'Admin User' },
            email_confirmed_at: '2026-11-17T00:00:00Z',
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'admin-local-1',
        email: 'admin@example.com',
        name: 'Admin User',
      });

      (prisma.user.count as any).mockResolvedValueOnce(50);
      (prisma.session.findMany as any)
        .mockResolvedValueOnce([]) // sessions in window
        .mockResolvedValueOnce([]); // scored sessions
      (prisma.feedback.count as any).mockResolvedValueOnce(40).mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.totalUsers).toBe(50);
      expect(res.body.data.interviewsPast14Days).toHaveLength(14);
      expect(res.body.data.feedbackCounts).toEqual({ ready: 40, failed: 1 });
      expect(Array.isArray(res.body.data.averageScoresByRole)).toBe(true);
    });

    it('returns HTTP 200 when user is confirmed via legacy confirmed_at field', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'admin-legacy-1',
            email: 'lead@tech.org',
            user_metadata: { full_name: 'Legacy Admin' },
            confirmed_at: '2026-11-17T00:00:00Z',
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'admin-local-legacy',
        email: 'lead@tech.org',
        name: 'Legacy Admin',
      });

      (prisma.user.count as any).mockResolvedValueOnce(10);
      (prisma.session.findMany as any).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      (prisma.feedback.count as any).mockResolvedValueOnce(5).mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', 'Bearer legacy-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/auth/me admin capability flag', () => {
    it('returns isAdmin: true for an authenticated user with confirmed email on admin list', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'admin-user-1',
            email: 'admin@example.com',
            user_metadata: { full_name: 'Admin' },
            email_confirmed_at: '2026-11-17T00:00:00Z',
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({ id: 'local-1', email: 'admin@example.com' }) // auth middleware
        .mockResolvedValueOnce({
          id: 'local-1',
          supabaseUserId: 'admin-user-1',
          email: 'admin@example.com',
          name: 'Admin',
        }); // /me route

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('admin@example.com');
      expect(res.body.data.isAdmin).toBe(true);
    });

    it('returns isAdmin: false when email matches admin list but email is unconfirmed', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'unconfirmed-user-1',
            email: 'admin@example.com',
            user_metadata: { full_name: 'Unconfirmed Admin' },
            email_confirmed_at: null,
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({ id: 'local-unconfirmed', email: 'admin@example.com' })
        .mockResolvedValueOnce({
          id: 'local-unconfirmed',
          supabaseUserId: 'unconfirmed-user-1',
          email: 'admin@example.com',
          name: 'Unconfirmed Admin',
        });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer unconfirmed-token');

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('admin@example.com');
      expect(res.body.data.isAdmin).toBe(false);
    });

    it('returns isAdmin: false for a regular candidate in getMe profile', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: {
          user: {
            id: 'candidate-user-2',
            email: 'candidate@example.com',
            user_metadata: { full_name: 'Candidate' },
            email_confirmed_at: '2026-11-17T00:00:00Z',
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any)
        .mockResolvedValueOnce({ id: 'local-2', email: 'candidate@example.com' })
        .mockResolvedValueOnce({
          id: 'local-2',
          supabaseUserId: 'candidate-user-2',
          email: 'candidate@example.com',
          name: 'Candidate',
        });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer candidate-token');

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('candidate@example.com');
      expect(res.body.data.isAdmin).toBe(false);
    });
  });
});
