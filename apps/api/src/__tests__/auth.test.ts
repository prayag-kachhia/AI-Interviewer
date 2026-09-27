import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';

vi.mock('@supabase/supabase-js', () => {
  const getUserMock = vi.fn();
  const deleteUserMock = vi.fn().mockResolvedValue({ error: null });
  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: getUserMock,
        admin: {
          deleteUser: deleteUserMock,
        },
      },
    })),
    __getUserMock: getUserMock,
    __deleteUserMock: deleteUserMock,
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    resume: {
      deleteMany: vi.fn(),
    },
  },
}));

import * as supabase from '@supabase/supabase-js';
const { __getUserMock, __deleteUserMock } = supabase as any;

describe('Supabase Authentication & Account Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects protected requests without a Bearer token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Authentication required');
  });

  it('rejects an invalid Supabase access token', async () => {
    __getUserMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid token' },
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid or expired token');
  });

  it('links an authenticated Supabase user to the application database', async () => {
    __getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'supabase-1',
          email: 'test@test.com',
          user_metadata: { full_name: 'Test User' },
        },
      },
      error: null,
    });

    (prisma.user.findUnique as any)
      .mockResolvedValueOnce(null) // lookup by supabaseUserId
      .mockResolvedValueOnce(null) // lookup by email
      .mockResolvedValueOnce({
        id: 'local-1',
        supabaseUserId: 'supabase-1',
        email: 'test@test.com',
        name: 'Test User',
      }); // getMe lookup by id

    (prisma.user.create as any).mockResolvedValueOnce({
      id: 'local-1',
      supabaseUserId: 'supabase-1',
      email: 'test@test.com',
      name: 'Test User',
    });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@test.com');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        supabaseUserId: 'supabase-1',
        email: 'test@test.com',
        name: 'Test User',
        passwordHash: 'supabase-auth',
      },
    });
  });

  it('uses an existing application user when the Supabase identity is already linked', async () => {
    __getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'supabase-1',
          email: 'test@test.com',
        },
      },
      error: null,
    });

    const linkedUser = {
      id: 'local-1',
      supabaseUserId: 'supabase-1',
      email: 'test@test.com',
      name: 'Test User',
    };
    (prisma.user.findUnique as any)
      .mockResolvedValueOnce(linkedUser) // middleware lookup by supabaseUserId
      .mockResolvedValueOnce(linkedUser); // getMe lookup by id

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('local-1');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  describe('DELETE /api/auth/account', () => {
    it('deletes resumes and user data when authenticated with a Supabase token', async () => {
      __getUserMock.mockResolvedValueOnce({
        data: { user: { id: 'supabase-del', email: 'delete@example.com' } },
        error: null,
      });
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'user-to-delete',
        supabaseUserId: 'supabase-del',
        name: 'To Delete',
        email: 'delete@example.com',
      });
      (prisma.resume.deleteMany as any).mockResolvedValueOnce({ count: 2 });
      (prisma.user.delete as any).mockResolvedValueOnce({ id: 'user-to-delete' });

      const res = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.resume.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-to-delete' },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-to-delete' },
      });
      expect(__deleteUserMock).toHaveBeenCalledWith('supabase-del');
    });
  });
});
