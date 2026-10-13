import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../server';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: vi.fn() } })),
}));

vi.mock('../utils/db', () => ({ default: {} }));

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
});
