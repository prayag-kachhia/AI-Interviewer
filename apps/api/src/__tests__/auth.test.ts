import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';

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

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
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

  it('links an existing unlinked application user by matching email', async () => {
    __getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'supabase-google-1',
          email: 'alice@example.com',
          user_metadata: { full_name: 'Alice Cooper' },
        },
      },
      error: null,
    });

    const unlinkedLocalUser = {
      id: 'local-alice',
      supabaseUserId: null,
      email: 'alice@example.com',
      name: 'Alice',
    };

    const linkedLocalUser = {
      ...unlinkedLocalUser,
      supabaseUserId: 'supabase-google-1',
    };

    (prisma.user.findUnique as any)
      .mockResolvedValueOnce(null) // lookup by supabaseUserId
      .mockResolvedValueOnce(unlinkedLocalUser) // lookup by email
      .mockResolvedValueOnce(linkedLocalUser); // getMe lookup by id

    (prisma.user.update as any).mockResolvedValueOnce(linkedLocalUser);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer valid-google-token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('local-alice');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'local-alice' },
      data: { supabaseUserId: 'supabase-google-1' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects authentication when email is already linked to a conflicting Supabase user', async () => {
    __getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: 'supabase-attacker',
          email: 'alice@example.com',
        },
      },
      error: null,
    });

    const alreadyLinkedUser = {
      id: 'local-alice',
      supabaseUserId: 'supabase-legitimate-alice',
      email: 'alice@example.com',
      name: 'Alice',
    };

    (prisma.user.findUnique as any)
      .mockResolvedValueOnce(null) // lookup by supabaseUserId
      .mockResolvedValueOnce(alreadyLinkedUser); // lookup by email

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer conflicting-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('This email is linked to another authentication account');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  describe('DELETE /api/auth/account', () => {
    const authenticatedUser = {
      id: 'local-user-a',
      supabaseUserId: 'supabase-user-a',
      email: 'user-a@example.com',
      name: 'User A',
    };

    const tx = {
      user: {
        deleteMany: vi.fn(),
      },
    };

    beforeEach(() => {
      __getUserMock.mockResolvedValue({
        data: {
          user: {
            id: authenticatedUser.supabaseUserId,
            email: authenticatedUser.email,
          },
        },
        error: null,
      });

      (prisma.user.findUnique as any).mockResolvedValue(authenticatedUser);

      (prisma.$transaction as any).mockImplementation(
        async (callback: (transaction: typeof tx) => Promise<void>) => {
          return callback(tx);
        }
      );

      tx.user.deleteMany.mockResolvedValue({ count: 1 });
      __deleteUserMock.mockResolvedValue({ data: {}, error: null });
    });

    it('deletes a user with resumes and sessions, then deletes the Supabase user', async () => {
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

      const res = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'user-to-delete' },
      });
      expect(__deleteUserMock).toHaveBeenCalledWith('supabase-del');
    });

    it('rejects requests without authentication with 401', async () => {
      const response = await request(app).delete('/api/auth/account');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        message: 'Authentication required',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(__deleteUserMock).not.toHaveBeenCalled();
    });

    it('successfully deletes the authenticated user account and returns 204', async () => {
      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});

      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'local-user-a' },
      });

      expect(__deleteUserMock).toHaveBeenCalledWith('supabase-user-a');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('passes only the authenticated user ID and Supabase user ID', async () => {
      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);

      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: authenticatedUser.id },
      });
      expect(tx.user.deleteMany).not.toHaveBeenCalledWith({
        where: { id: 'other-user-id' },
      });

      expect(__deleteUserMock).toHaveBeenCalledWith(authenticatedUser.supabaseUserId);
      expect(__deleteUserMock).not.toHaveBeenCalledWith('other-supabase-id');
    });

    it('uses a Prisma transaction for atomic local deletion', async () => {
      await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(typeof (prisma.$transaction as any).mock.calls[0][0]).toBe('function');
    });

    it('rolls back the transaction and returns HTTP 500 when Supabase deletion fails', async () => {
      const supabaseError = new Error('Supabase Auth service unavailable');
      __deleteUserMock.mockResolvedValueOnce({
        data: null,
        error: supabaseError,
      });

      let transactionAborted = false;
      (prisma.$transaction as any).mockImplementationOnce(
        async (callback: (transaction: typeof tx) => Promise<void>) => {
          try {
            await callback(tx);
          } catch (err) {
            transactionAborted = true;
            throw err;
          }
        }
      );

      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        message: 'Failed to delete account. Please try again.',
      });

      expect(transactionAborted).toBe(true);
      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'local-user-a' },
      });
      expect(__deleteUserMock).toHaveBeenCalledWith('supabase-user-a');
    });

    it('does not target other users records during deletion', async () => {
      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);

      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: authenticatedUser.id },
      });
      expect(tx.user.deleteMany).not.toHaveBeenCalledWith({
        where: { id: 'unrelated-user' },
      });
    });

    it('handles missing local user record without throwing uncontrolled errors', async () => {
      tx.user.deleteMany.mockResolvedValueOnce({ count: 0 });

      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);
      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'local-user-a' },
      });
      expect(__deleteUserMock).toHaveBeenCalledWith('supabase-user-a');
    });

    it('supports successful retry after a previously failed deletion attempt', async () => {
      // Attempt 1: Supabase fails
      __deleteUserMock.mockResolvedValueOnce({
        data: null,
        error: new Error('Temporary gateway error'),
      });

      const firstResponse = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(firstResponse.status).toBe(500);

      // Attempt 2: Retry succeeds
      __deleteUserMock.mockResolvedValueOnce({
        data: {},
        error: null,
      });

      const retryResponse = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(retryResponse.status).toBe(204);
      expect(tx.user.deleteMany).toHaveBeenCalledTimes(2);
      expect(__deleteUserMock).toHaveBeenCalledTimes(2);
    });

    it('repeated local cleanup does not produce an unnecessary record-not-found failure', async () => {
      tx.user.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(204);
      expect(tx.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'local-user-a' },
      });
    });

    it('rejects requests with 401 when user identifiers are missing', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'local-user-a',
        supabaseUserId: null,
        email: 'user-a@example.com',
        name: 'User A',
      });

      const response = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        message: 'Unauthorized',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(__deleteUserMock).not.toHaveBeenCalled();
    });
  });
});