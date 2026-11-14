import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { ROLES, TurnSpeaker } from '@interview/contracts';
import {
  evaluateTranscript,
  type TranscriptTurn,
} from '../src/services/evaluator.service';

// Load environment variables from apps/api/.env if not already loaded by the runtime
if (!process.env.GEMINI_API_KEY) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(currentDir, '../.env') });
}

const TurnSchema = z.object({
  speaker: TurnSpeaker,
  text: z.string(),
});
const TranscriptArraySchema = z.array(TurnSchema);
const TranscriptObjectSchema = z.object({
  turns: TranscriptArraySchema,
});

export function parseArgs(argv: string[]) {
  let filePath: string | undefined;
  let roleId = 'software-engineer';
  let difficulty: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--role') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --role flag');
      }
      roleId = argv[++i];
    } else if (arg.startsWith('--role=')) {
      roleId = arg.slice('--role='.length);
    } else if (arg === '--difficulty') {
      if (i + 1 >= argv.length) {
        throw new Error('Missing value for --difficulty flag');
      }
      difficulty = argv[++i];
    } else if (arg.startsWith('--difficulty=')) {
      difficulty = arg.slice('--difficulty='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag "${arg}"`);
    } else {
      if (!filePath) {
        filePath = arg;
      } else {
        throw new Error(`Unexpected positional argument: "${arg}"`);
      }
    }
  }

  return { filePath, roleId, difficulty };
}

export function loadTranscript(filePath: string): TranscriptTurn[] {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }

  let content: string;
  try {
    content = readFileSync(resolved, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read file: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Malformed transcript file: content is not valid JSON');
  }

  const arrayResult = TranscriptArraySchema.safeParse(parsed);
  if (arrayResult.success) {
    return arrayResult.data;
  }

  const objResult = TranscriptObjectSchema.safeParse(parsed);
  if (objResult.success) {
    return objResult.data.turns;
  }

  throw new Error(
    'Malformed transcript file: expected an array of turns (or an object with a "turns" array) with valid "speaker" ("AI" | "CANDIDATE") and "text"'
  );
}

export function resolveRole(roleId: string) {
  const matched = ROLES.find(
    (r) =>
      r.id.toLowerCase() === roleId.toLowerCase() ||
      r.label.toLowerCase() === roleId.toLowerCase()
  );
  if (!matched) {
    const available = ROLES.map((r) => r.id).join(', ');
    throw new Error(`Unknown role "${roleId}". Valid roles: ${available}`);
  }
  return matched;
}

export async function runCLI(argv: string[] = process.argv.slice(2)) {
  try {
    const { filePath, roleId, difficulty } = parseArgs(argv);

    if (!filePath) {
      const available = ROLES.map((r) => r.id).join(', ');
      console.error(
        `Usage: bun scripts/evaluate.ts <path/to/transcript.json> [--role <role>] [--difficulty <basic|advanced>]\nValid roles: ${available}`
      );
      process.exit(1);
    }

    const role = resolveRole(roleId);
    const turns = loadTranscript(filePath);

    const start = performance.now();
    const evaluation = await evaluateTranscript({
      roleId: role.id,
      turns,
      difficulty,
    });
    const wallTimeMs = Math.round(performance.now() - start);

    console.log(
      JSON.stringify(
        { summary: evaluation.summary, scores: evaluation.scores },
        null,
        2
      )
    );
    console.log(`Wall time: ${wallTimeMs} ms`);

    if (evaluation.usageMetadata) {
      console.log(
        'usageMetadata:',
        JSON.stringify(evaluation.usageMetadata, null, 2)
      );
    }
  } catch (err) {
    // Acceptance criteria: Given a malformed file, then a clear error, not a stack trace.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run automatically when invoked directly as CLI
if (import.meta.main) {
  runCLI();
}
