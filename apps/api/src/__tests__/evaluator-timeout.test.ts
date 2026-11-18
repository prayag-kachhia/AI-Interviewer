import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Records what the evaluator passes to the Gemini SDK, without ever reaching the real API.
const sdk = vi.hoisted(() => ({ options: [] as unknown[], configs: [] as unknown[] }));
vi.mock('@google/genai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  class GoogleGenAI {
    models = {
      generateContent: async (request: { config?: unknown }) => {
        sdk.configs.push(request.config);
        throw new Error('stopped by the test');
      },
    };
    constructor(options: unknown) {
      sdk.options.push(options);
    }
  }
  return { ...actual, GoogleGenAI };
});

import { EVALUATION_TIMEOUT_MS, evaluateTranscript } from '../services/evaluator.service';

describe('evaluator timeout', () => {
  const savedKey = process.env.GEMINI_API_KEY;
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    sdk.options.length = 0;
    sdk.configs.length = 0;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedKey;
  });

  it('gives Gemini long enough to grade a full-length interview', () => {
    // With per-answer feedback, a 15-minute interview (10-20 answers) took longer than 12 s
    // and every feedback job failed with 504 DEADLINE_EXCEEDED (18 Nov).
    expect(EVALUATION_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
  });

  it('sends the timeout to the SDK, which forwards it to Google as the server deadline', async () => {
    await expect(
      evaluateTranscript({
        roleId: 'software-engineer',
        turns: [
          { speaker: 'AI', text: 'How would you design a job queue?' },
          { speaker: 'CANDIDATE', text: 'A table of jobs, claimed with SKIP LOCKED.' },
        ],
      })
    ).rejects.toThrow('stopped by the test');

    expect(sdk.options).toEqual([expect.objectContaining({ httpOptions: { timeout: EVALUATION_TIMEOUT_MS } })]);
    expect(sdk.configs).toEqual([expect.objectContaining({ abortSignal: expect.any(AbortSignal) })]);
  });
});
