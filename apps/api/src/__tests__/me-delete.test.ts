import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../db';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
      admin: {
        deleteUser: mocks.deleteUser,
      },
    },
  })),
}));

vi.mock('../db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('DELETE /api/me', () => {
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
    vi.clearAllMocks();

    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'supabase-user-a',
          email: 'user-a@example.com',
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
    mocks.deleteUser.mockResolvedValue({ data: {}, error: null });
  });

  it('rejects requests without authentication with 401', async () => {
    const response = await request(app).delete('/api/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication required',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it('successfully deletes the authenticated user account and returns 204', async () => {
    const response = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});

    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'local-user-a' },
    });

    expect(mocks.deleteUser).toHaveBeenCalledWith('supabase-user-a');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('passes only the authenticated user ID and Supabase user ID', async () => {
    const response = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(204);

    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: authenticatedUser.id },
    });
    expect(tx.user.deleteMany).not.toHaveBeenCalledWith({
      where: { id: 'other-user-id' },
    });

    expect(mocks.deleteUser).toHaveBeenCalledWith(authenticatedUser.supabaseUserId);
    expect(mocks.deleteUser).not.toHaveBeenCalledWith('other-supabase-id');
  });

  it('uses a Prisma transaction for atomic local deletion', async () => {
    await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof (prisma.$transaction as any).mock.calls[0][0]).toBe('function');
  });

  it('rolls back the transaction and returns HTTP 500 when Supabase deletion fails', async () => {
    const supabaseError = new Error('Supabase Auth service unavailable');
    mocks.deleteUser.mockResolvedValueOnce({
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
      .delete('/api/me')
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
    expect(mocks.deleteUser).toHaveBeenCalledWith('supabase-user-a');
  });

  it('does not target other users records during deletion', async () => {
    const response = await request(app)
      .delete('/api/me')
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
    // When the local user record is already absent, deleteMany returns count 0
    tx.user.deleteMany.mockResolvedValueOnce({ count: 0 });

    const response = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(204);
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'local-user-a' },
    });
    expect(mocks.deleteUser).toHaveBeenCalledWith('supabase-user-a');
  });

  it('supports successful retry after a previously failed deletion attempt', async () => {
    // Attempt 1: Supabase fails
    mocks.deleteUser.mockResolvedValueOnce({
      data: null,
      error: new Error('Temporary gateway error'),
    });

    const firstResponse = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(firstResponse.status).toBe(500);

    // Attempt 2: Retry succeeds
    mocks.deleteUser.mockResolvedValueOnce({
      data: {},
      error: null,
    });

    const retryResponse = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(retryResponse.status).toBe(204);
    expect(tx.user.deleteMany).toHaveBeenCalledTimes(2);
    expect(mocks.deleteUser).toHaveBeenCalledTimes(2);
  });

  it('repeated local cleanup does not produce an unnecessary record-not-found failure', async () => {
    // Simulate cleanup run on already deleted user
    tx.user.deleteMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(204);
    expect(tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'local-user-a' },
    });
  });

  it('rejects requests with 401 when user identifiers are missing', async () => {
    // User without supabaseUserId
    (prisma.user.findUnique as any).mockResolvedValueOnce({
      id: 'local-user-a',
      supabaseUserId: null,
      email: 'user-a@example.com',
      name: 'User A',
    });

    const response = await request(app)
      .delete('/api/me')
      .set('Authorization', 'Bearer valid-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Unauthorized',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
