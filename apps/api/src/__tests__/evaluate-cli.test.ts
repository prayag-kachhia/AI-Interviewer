import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as evaluatorService from '../services/evaluator.service';
import {
  parseArgs,
  resolveRole,
  loadTranscript,
  runCLI,
} from '../../scripts/evaluate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/transcripts');

describe('CLI - evaluate.ts', () => {
  describe('parseArgs', () => {
    it('parses transcript path with default role', () => {
      const { filePath, roleId } = parseArgs(['path/to/transcript.json']);
      expect(filePath).toBe('path/to/transcript.json');
      expect(roleId).toBe('software-engineer');
    });

    it('parses transcript path with --role flag', () => {
      const { filePath, roleId } = parseArgs([
        'path/to/transcript.json',
        '--role',
        'data-analyst',
      ]);
      expect(filePath).toBe('path/to/transcript.json');
      expect(roleId).toBe('data-analyst');
    });

    it('parses transcript path with --role= syntax', () => {
      const { filePath, roleId } = parseArgs([
        'path/to/transcript.json',
        '--role=backend-developer',
      ]);
      expect(filePath).toBe('path/to/transcript.json');
      expect(roleId).toBe('backend-developer');
    });

    it('throws when --role has no value', () => {
      expect(() => parseArgs(['path/to/transcript.json', '--role'])).toThrow(
        'Missing value for --role flag'
      );
    });
  });

  describe('resolveRole', () => {
    it('resolves valid role ids', () => {
      expect(resolveRole('software-engineer').label).toBe('Software Engineer');
      expect(resolveRole('data-analyst').label).toBe('Data Analyst');
      expect(resolveRole('backend-developer').label).toBe('Backend Developer');
    });

    it('throws a clear error on unknown role', () => {
      expect(() => resolveRole('unknown-role')).toThrow(
        'Unknown role "unknown-role". Valid roles: software-engineer, data-analyst, backend-developer'
      );
    });
  });

  describe('loadTranscript', () => {
    it('loads a valid array transcript fixture', () => {
      const goodPath = path.join(FIXTURES_DIR, 'good.json');
      const turns = loadTranscript(goodPath);
      expect(turns.length).toBeGreaterThan(0);
      expect(turns[0].speaker).toBe('AI');
    });

    it('throws clear error if file does not exist', () => {
      expect(() => loadTranscript('non-existent.json')).toThrow(
        'File not found: non-existent.json'
      );
    });

    it('throws clear error on malformed JSON file', () => {
      const readmePath = path.join(FIXTURES_DIR, 'README.md');
      expect(() => loadTranscript(readmePath)).toThrow(
        'Malformed transcript file: content is not valid JSON'
      );
    });
  });

  describe('runCLI', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('prints usage and exits with 1 when no transcript path is provided', async () => {
      await expect(runCLI([])).rejects.toThrow('process.exit called with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: bun scripts/evaluate.ts')
      );
    });

    it('prints a clear error and exits with 1 on a malformed file without stack trace', async () => {
      const readmePath = path.join(FIXTURES_DIR, 'README.md');
      await expect(runCLI([readmePath])).rejects.toThrow('process.exit called with code 1');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error: Malformed transcript file: content is not valid JSON'
      );
    });

    it('prints feedback, wall time, and usageMetadata on valid run', async () => {
      const goodPath = path.join(FIXTURES_DIR, 'good.json');
      vi.spyOn(evaluatorService, 'evaluateTranscript').mockResolvedValueOnce({
        summary: 'Excellent demonstration of distributed systems.',
        scores: [
          { category: 'Communication', score: 5, comment: 'Clear.', strengths: [], improvements: [], quote: '' },
          { category: 'Technical depth', score: 5, comment: 'Deep.', strengths: [], improvements: [], quote: '' },
          { category: 'Structure', score: 5, comment: 'Organized.', strengths: [], improvements: [], quote: '' },
        ],
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 120,
          totalTokenCount: 620,
        },
      });

      await runCLI([goodPath, '--role', 'software-engineer']);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Excellent demonstration of distributed systems.')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Wall time: \d+ ms/)
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'usageMetadata:',
        expect.stringContaining('"totalTokenCount": 620')
      );
    });
  });
});
