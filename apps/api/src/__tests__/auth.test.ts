import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server';
import prisma from '../utils/db';
import { generateLocalToken, hashPassword } from '../utils/token';

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      auth: {
        getUser: vi.fn(),
        admin: {
          deleteUser: vi.fn().mockResolvedValue({}),
        },
      },
    })),
  };
});

vi.mock('../utils/db', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    resume: {
      deleteMany: vi.fn(),
    },
  },
}));

describe('Auth Endpoints & Account Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/auth/check-user', () => {
    it('returns exists: true when user is found', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
      });

      const res = await request(app)
        .post('/api/auth/check-user')
        .send({ email: 'jane@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.name).toBe('Jane Doe');
    });

    it('returns exists: false when user is not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/auth/check-user')
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(false);
    });
  });

  describe('POST /api/auth/register', () => {
    it('registers a new user and returns a token', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(null);
      (prisma.user.create as any).mockResolvedValueOnce({
        id: 'user-new',
        name: 'New User',
        email: 'new@example.com',
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'New User', email: 'new@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('new@example.com');
    });

    it('returns 400 if user already exists', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'existing-id',
        email: 'existing@example.com',
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'Existing', email: 'existing@example.com', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.exists).toBe(true);
      expect(res.body.message).toContain('already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns 404 isNewUser: true if email not found', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'notfound@example.com', password: 'password123' });

      expect(res.status).toBe(404);
      expect(res.body.isNewUser).toBe(true);
      expect(res.body.message).toContain('new user');
    });

    it('returns 200 and token when password matches', async () => {
      const hashed = hashPassword('correctPassword');
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'user-logged',
        name: 'Logged User',
        email: 'user@example.com',
        passwordHash: hashed,
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'user@example.com', password: 'correctPassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
    });
  });

  describe('POST /api/auth/logout', () => {
    it('acknowledges logout and confirms data is preserved', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('preserved');
    });
  });

  describe('DELETE /api/auth/account', () => {
    it('deletes resumes and user data when authenticated with local token', async () => {
      const token = generateLocalToken('user-to-delete', 'delete@example.com');
      (prisma.user.findUnique as any).mockResolvedValueOnce({
        id: 'user-to-delete',
        name: 'To Delete',
        email: 'delete@example.com',
      });
      (prisma.resume.deleteMany as any).mockResolvedValueOnce({ count: 2 });
      (prisma.user.delete as any).mockResolvedValueOnce({ id: 'user-to-delete' });

      const res = await request(app)
        .delete('/api/auth/account')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.resume.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-to-delete' },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-to-delete' },
      });
    });
  });
});
