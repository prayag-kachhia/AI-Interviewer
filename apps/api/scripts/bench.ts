/**
 * Evaluation benchmark — runs the real evaluator against every fixture 3 times
 * and reports accuracy (score ranges), p50/p95 latency, and cost per interview.
 *
 * Usage:
 *   bun scripts/bench.ts                 # normal run
 *   bun scripts/bench.ts --broken-prompt  # demonstrate regression detection
 *   bun scripts/bench.ts --runs 1         # quick smoke test
 *
 * NOT run in CI (it costs money). Run before merging any prompt or rubric change.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import {
  evaluateTranscript,
  buildEvaluationPrompt,
  EVALUATION_TIMEOUT_MS,
  type TranscriptTurn,
  type EvaluationUsageMetadata,
  type GenerateResult,
} from '../src/services/evaluator.service';
import { loadTranscript, resolveRole } from './evaluate';

// ── env ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.GEMINI_API_KEY) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// ── constants ────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(
  __dirname,
  '../src/__tests__/fixtures/transcripts'
);
const LATENCY_TARGET_MS = 15_000;
const DEFAULT_RUNS = 3;

/**
 * Minimum gap between consecutive Gemini calls.
 * Free tier allows 5 req/min → 1 every 12 s. Default: 13 s (safety margin).
 * Override with BENCH_INTER_CALL_DELAY_MS or --delay <ms>.
 */
const DEFAULT_INTER_CALL_DELAY_MS = 13_000;

/** Timeout used for bench runs — longer than the production 12 s to handle model load spikes. */
const BENCH_TIMEOUT_MS = 30_000;

/** Max retries per run for transient 429 / 503 errors. */
const MAX_RETRIES = 3;

export interface ModelPricing {
  inputCostPer1M: number;
  outputCostPer1M: number;
}

/**
 * Published pricing for supported Gemini Flash models (USD per 1 M tokens, standard paid tier).
 * - gemini-3.8-flash (production default): introductory rates active through 2026-12-31.
 * - gemini-3.5-flash: standard paid tier rates.
 * See: https://ai.google.dev/gemini-api/docs/pricing
 */
export const KNOWN_MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-3.8-flash': {
    inputCostPer1M: 0.75,
    outputCostPer1M: 3.75,
  },
  'gemini-3.5-flash': {
    inputCostPer1M: 1.5,
    outputCostPer1M: 9.0,
  },
};

export const DEFAULT_BENCH_MODEL = 'gemini-3.8-flash';

/**
 * Resolves model-aware pricing with environment variable overrides.
 */
export function resolveBenchmarkPricing(
  model?: string,
  env: NodeJS.ProcessEnv = process.env
): {
  model: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  usdToInr: number;
  isFallback: boolean;
} {
  const resolvedModel =
    model?.trim() ||
    env.GEMINI_EVAL_MODEL?.trim() ||
    DEFAULT_BENCH_MODEL;
  const normalizedModel = resolvedModel.trim();
  const isKnown = normalizedModel in KNOWN_MODEL_PRICING;
  const basePricing =
    KNOWN_MODEL_PRICING[normalizedModel] ?? KNOWN_MODEL_PRICING[DEFAULT_BENCH_MODEL];

  const envInput = env.BENCH_INPUT_COST_USD_PER_1M;
  const envOutput = env.BENCH_OUTPUT_COST_USD_PER_1M;
  const envUsdToInr = env.BENCH_USD_TO_INR;

  const hasExplicitRates =
    envInput !== undefined && envInput !== '' && envOutput !== undefined && envOutput !== '';

  const inputCostPer1M =
    envInput !== undefined && envInput !== '' && !Number.isNaN(Number(envInput))
      ? Number(envInput)
      : basePricing.inputCostPer1M;

  const outputCostPer1M =
    envOutput !== undefined && envOutput !== '' && !Number.isNaN(Number(envOutput))
      ? Number(envOutput)
      : basePricing.outputCostPer1M;

  const usdToInr =
    envUsdToInr !== undefined && envUsdToInr !== '' && !Number.isNaN(Number(envUsdToInr))
      ? Number(envUsdToInr)
      : 84.0;

  return {
    model: normalizedModel || DEFAULT_BENCH_MODEL,
    inputCostPer1M,
    outputCostPer1M,
    usdToInr,
    isFallback: !isKnown && !hasExplicitRates,
  };
}

export function calculateBenchmarkCost(
  avgPromptTokens: number,
  avgOutputTokens: number,
  pricing: { inputCostPer1M: number; outputCostPer1M: number; usdToInr: number }
): {
  costUSD: number;
  costINR: number;
  monthly100USD: number;
  monthly100INR: number;
} {
  const costUSD =
    (avgPromptTokens / 1_000_000) * pricing.inputCostPer1M +
    (avgOutputTokens / 1_000_000) * pricing.outputCostPer1M;
  const costINR = costUSD * pricing.usdToInr;
  const monthly100USD = costUSD * 100;
  const monthly100INR = costINR * 100;

  return {
    costUSD,
    costINR,
    monthly100USD,
    monthly100INR,
  };
}

const defaultPricing = resolveBenchmarkPricing();
const INPUT_COST_USD_PER_1M = defaultPricing.inputCostPer1M;
const OUTPUT_COST_USD_PER_1M = defaultPricing.outputCostPer1M;
const USD_TO_INR = defaultPricing.usdToInr;

// ── types ────────────────────────────────────────────────────────────────────

interface ExpectedScore {
  category: string;
  min: number;
  max: number;
  reason: string;
}

interface FixtureExpected {
  role: string;
  scores: ExpectedScore[];
}

interface RunResult {
  wallMs: number;
  promptTokens: number;
  outputTokens: number;
  scores: { category: string; score: number }[];
  error?: string;
}

interface FixtureResult {
  name: string;
  role: string;
  runs: RunResult[];
  expected: FixtureExpected | undefined;
  /** undefined when there is no expected file (e.g. empty-answers). */
  pass: boolean | undefined;
  failReasons: string[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function pad(s: string, n: number, right = false): string {
  return right ? s.padEnd(n) : s.padStart(n);
}

/**
 * Builds a broken version of the normal evaluation prompt to demonstrate that
 * the benchmark catches regressions. The overridden instruction forces the
 * model to return 3 for every category regardless of transcript quality, which
 * falls outside the expected ranges for the strongest and weakest fixtures.
 */
function buildBrokenPrompt(input: Parameters<typeof buildEvaluationPrompt>[0]): string {
  const normal = buildEvaluationPrompt(input);
  return normal.replace(
    'Score ONLY the candidate\'s answers, using this rubric. Each score is an integer from 1 (poor) to 5 (excellent).',
    'IGNORE the rubric. Assign every category a score of exactly 3 regardless of the candidate\'s quality. Each score is an integer from 1 (poor) to 5 (excellent).'
  );
}

function parseArgs(argv: string[]): { runs: number; brokenPrompt: boolean; delayMs: number } {
  let runs = DEFAULT_RUNS;
  let brokenPrompt = false;
  let delayMs = Number(process.env.BENCH_INTER_CALL_DELAY_MS ?? DEFAULT_INTER_CALL_DELAY_MS);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--broken-prompt') {
      brokenPrompt = true;
    } else if (argv[i] === '--runs' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1)
        throw new Error('--runs must be a positive integer');
      runs = n;
    } else if (argv[i].startsWith('--runs=')) {
      const n = Number(argv[i].slice('--runs='.length));
      if (!Number.isInteger(n) || n < 1)
        throw new Error('--runs must be a positive integer');
      runs = n;
    } else if (argv[i] === '--delay' && argv[i + 1]) {
      delayMs = Number(argv[++i]);
    } else if (argv[i].startsWith('--delay=')) {
      delayMs = Number(argv[i].slice('--delay='.length));
    }
  }
  return { runs, brokenPrompt, delayMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses the retry-after delay (in seconds) from a Gemini 429 error string.
 * Falls back to `defaultMs` if not found.
 */
function parseRetryAfterMs(errorMessage: string, defaultMs: number): number {
  try {
    const body = JSON.parse(errorMessage) as {
      error?: { details?: Array<{ retryDelay?: string }> };
    };
    const retryInfo = body.error?.details?.find((d) => d.retryDelay);
    if (retryInfo?.retryDelay) {
      const secs = parseFloat(retryInfo.retryDelay.replace('s', ''));
      if (!isNaN(secs)) return Math.ceil(secs * 1000) + 2_000; // +2 s buffer
    }
  } catch {
    /* ignore parse errors */
  }
  return defaultMs;
}

/**
 * Runs evaluateTranscript with automatic retry on 429 / 503 errors.
 */
async function runWithRetry(
  fn: () => ReturnType<typeof evaluateTranscript>,
  maxRetries: number,
  defaultBackoffMs: number
): ReturnType<typeof evaluateTranscript> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      const msg = lastError.message;
      const isRetryable =
        msg.includes('"code":429') ||
        msg.includes('"code":503') ||
        msg.includes('"code":504') ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('DEADLINE_EXCEEDED');
      if (!isRetryable || attempt === maxRetries) break;
      const waitMs =
        msg.includes('"code":429') || msg.includes('RESOURCE_EXHAUSTED')
          ? parseRetryAfterMs(msg, defaultBackoffMs)
          : defaultBackoffMs;
      process.stdout.write(`[retry ${attempt + 1}/${maxRetries} in ${Math.round(waitMs / 1000)}s] `);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { runs: runsPerFixture, brokenPrompt, delayMs } = parseArgs(process.argv.slice(2));
  const activeModel = process.env.GEMINI_EVAL_MODEL?.trim() || DEFAULT_BENCH_MODEL;

  if (brokenPrompt) {
    console.log(
      '⚠️  --broken-prompt mode: prompts are intentionally corrupted to demonstrate regression detection.\n'
    );
  }
  console.log(`Inter-call delay: ${delayMs} ms  |  Timeout per run: ${BENCH_TIMEOUT_MS} ms  |  Runs: ${runsPerFixture}\n`);

  // Discover fixtures: all *.json that are NOT *.expected.json
  const files = readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
    .sort();

  const fixtureResults: FixtureResult[] = [];
  let isFirstCall = true;

  for (const file of files) {
    const name = file.replace('.json', '');
    const fixturePath = path.join(FIXTURES_DIR, file);
    const expectedPath = path.join(FIXTURES_DIR, `${name}.expected.json`);

    // Load expected ranges (optional)
    let expected: FixtureExpected | undefined;
    if (existsSync(expectedPath)) {
      try {
        expected = JSON.parse(readFileSync(expectedPath, 'utf-8')) as FixtureExpected;
      } catch {
        console.warn(`  WARN: Cannot parse ${name}.expected.json — skipping range check.`);
      }
    }

    // Load transcript
    let turns: TranscriptTurn[];
    try {
      turns = loadTranscript(fixturePath);
    } catch (err) {
      console.log(`\n▶ ${name} — SKIP (load error: ${(err as Error).message})`);
      continue;
    }

    // Check for evaluatable content
    const hasAnswers = turns.some((t) => t.speaker === 'CANDIDATE' && t.text.trim());
    if (!hasAnswers) {
      console.log(`\n▶ ${name} — SKIP (no candidate answers; expected rejection)`);
      fixtureResults.push({
        name,
        role: expected?.role ?? 'n/a',
        runs: [],
        expected: undefined,
        pass: true, // correctly rejected before LLM call
        failReasons: [],
      });
      continue;
    }

    // Resolve role
    let role: { id: string; label: string };
    try {
      role = resolveRole(expected?.role ?? 'software-engineer');
    } catch {
      role = resolveRole('software-engineer');
    }

    console.log(`\n▶ ${name}  [${role.label}]`);

    const runs: RunResult[] = [];

    for (let run = 0; run < runsPerFixture; run++) {
      // Throttle to avoid free-tier rate limits (5 req/min)
      if (!isFirstCall) {
        await sleep(delayMs);
      }
      isFirstCall = false;
      process.stdout.write(`  run ${run + 1}/${runsPerFixture} … `);
      const start = performance.now();

      try {
        // Build a Gemini generate function that optionally uses the broken prompt.
        const generateFn = brokenPrompt
          ? async (_prompt: string): Promise<GenerateResult> => {
              const apiKey = process.env.GEMINI_API_KEY?.trim();
              if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');
              const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: BENCH_TIMEOUT_MS } });
              const brokenP = buildBrokenPrompt({ roleId: role.id, turns });
              const response = await ai.models.generateContent({
                model: process.env.GEMINI_EVAL_MODEL?.trim() ?? 'gemini-3.8-flash',
                contents: brokenP,
                config: {
                  responseMimeType: 'application/json',
                  temperature: 0.2,
                  abortSignal: AbortSignal.timeout(BENCH_TIMEOUT_MS),
                },
              });
              return {
                text: response.text ?? '',
                usageMetadata: response.usageMetadata
                  ? {
                      promptTokenCount: response.usageMetadata.promptTokenCount,
                      candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
                      totalTokenCount: response.usageMetadata.totalTokenCount,
                    }
                  : undefined,
              };
            }
          : undefined;

        const result = await runWithRetry(
          () =>
            evaluateTranscript(
              { roleId: role.id, turns },
              generateFn ? { generate: generateFn, timeoutMs: BENCH_TIMEOUT_MS } : { timeoutMs: BENCH_TIMEOUT_MS }
            ),
          MAX_RETRIES,
          delayMs
        );
        const wallMs = Math.round(performance.now() - start);

        const runResult: RunResult = {
          wallMs,
          promptTokens: result.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
          scores: result.scores.map((s) => ({ category: s.category, score: s.score })),
        };
        runs.push(runResult);
        console.log(
          `${wallMs} ms  in=${runResult.promptTokens} out=${runResult.outputTokens}  ` +
            runResult.scores.map((s) => `${s.category[0]}:${s.score}`).join(' ')
        );
      } catch (err) {
        const wallMs = Math.round(performance.now() - start);
        runs.push({ wallMs, promptTokens: 0, outputTokens: 0, scores: [], error: (err as Error).message });
        console.log(`ERROR — ${(err as Error).message}`);
      }
    }

    // Pass/fail: average score per category must be within expected range
    const failReasons: string[] = [];
    let pass: boolean | undefined = undefined;

    if (expected) {
      pass = true;
      const validRuns = runs.filter((r) => !r.error);
      if (validRuns.length === 0) {
        failReasons.push('All runs errored');
        pass = false;
      } else {
        for (const exp of expected.scores) {
          const scores = validRuns
            .map((r) => r.scores.find((s) => s.category === exp.category)?.score)
            .filter((v): v is number => v !== undefined);

          if (scores.length === 0) {
            failReasons.push(`Category "${exp.category}" missing from all runs`);
            pass = false;
            continue;
          }

          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          if (avg < exp.min || avg > exp.max) {
            failReasons.push(
              `${exp.category}: avg=${avg.toFixed(2)} outside [${exp.min}–${exp.max}]`
            );
            pass = false;
          }
        }
      }
    }

    fixtureResults.push({ name, role: role.label, runs, expected, pass, failReasons });
  }

  // ── Summary table ───────────────────────────────────────────────────────────

  const separator = '─'.repeat(88);
  console.log('\n' + '═'.repeat(88));
  console.log('  EVALUATION BENCHMARK RESULTS' + (brokenPrompt ? '  (broken-prompt mode)' : ''));
  console.log('═'.repeat(88));

  console.log('\nPer-fixture results (avg over runs):');
  console.log(separator);
  console.log(
    pad('Fixture', 32, true) +
      pad('Role', 20, true) +
      pad('ms', 7) +
      pad('in', 7) +
      pad('out', 7) +
      pad('Status', 10)
  );
  console.log(separator);

  let passCount = 0;
  let totalWithExpected = 0;

  for (const { name, role, runs, expected, pass, failReasons } of fixtureResults) {
    const validRuns = runs.filter((r) => !r.error);
    const avgMs =
      validRuns.length > 0
        ? Math.round(validRuns.reduce((s, r) => s + r.wallMs, 0) / validRuns.length)
        : 0;
    const avgIn =
      validRuns.length > 0
        ? Math.round(validRuns.reduce((s, r) => s + r.promptTokens, 0) / validRuns.length)
        : 0;
    const avgOut =
      validRuns.length > 0
        ? Math.round(validRuns.reduce((s, r) => s + r.outputTokens, 0) / validRuns.length)
        : 0;

    let status: string;
    if (pass === undefined) {
      status = '——';
    } else if (pass) {
      status = '✅ PASS';
      passCount++;
    } else {
      status = '❌ FAIL';
    }
    if (pass !== undefined) totalWithExpected++;

    console.log(
      pad(name, 32, true) +
        pad(role.length > 18 ? role.slice(0, 17) + '…' : role, 20, true) +
        pad(avgMs > 0 ? String(avgMs) : '—', 7) +
        pad(avgIn > 0 ? String(avgIn) : '—', 7) +
        pad(avgOut > 0 ? String(avgOut) : '—', 7) +
        pad(status, 10)
    );

    for (const reason of [...new Set(failReasons)]) {
      console.log(`  ↳ ${reason}`);
    }
  }

  console.log(separator);

  // ── Latency ─────────────────────────────────────────────────────────────────

  const allWallMs = fixtureResults
    .flatMap((f) => f.runs.filter((r) => !r.error).map((r) => r.wallMs))
    .sort((a, b) => a - b);

  const p50 = percentile(allWallMs, 50);
  const p95 = percentile(allWallMs, 95);
  const latencyOk = p95 < LATENCY_TARGET_MS;

  console.log('\nLatency:');
  console.log(`  p50 = ${p50} ms`);
  console.log(
    `  p95 = ${p95} ms   target: <${LATENCY_TARGET_MS} ms   ${latencyOk ? '✅' : '❌'}`
  );

  // ── Cost ─────────────────────────────────────────────────────────────────────

  const allValidRuns = fixtureResults.flatMap((f) => f.runs.filter((r) => !r.error));
  const totalPrompt = allValidRuns.reduce((s, r) => s + r.promptTokens, 0);
  const totalOutput = allValidRuns.reduce((s, r) => s + r.outputTokens, 0);
  const n = allValidRuns.length;

  if (n > 0) {
    const avgIn = totalPrompt / n;
    const avgOut = totalOutput / n;
    const pricing = resolveBenchmarkPricing(activeModel);
    const { costUSD, costINR, monthly100USD, monthly100INR } = calculateBenchmarkCost(
      avgIn,
      avgOut,
      pricing
    );

    if (pricing.isFallback) {
      console.warn(
        `  ⚠️  Note: "${pricing.model}" has no published pricing in KNOWN_MODEL_PRICING; using ${DEFAULT_BENCH_MODEL} fallback pricing. Set BENCH_INPUT_COST_USD_PER_1M and BENCH_OUTPUT_COST_USD_PER_1M for custom models.`
      );
    }
    console.log(`\nCost (${pricing.model}, avg token counts across all runs):`);
    console.log(`  Avg prompt tokens  : ${Math.round(avgIn)}`);
    console.log(`  Avg output tokens  : ${Math.round(avgOut)}`);
    console.log(
      `  Cost/interview     : ₹${costINR.toFixed(4)}  (US$${costUSD.toFixed(6)})`
    );
    console.log(
      `  Monthly (100/month): ₹${monthly100INR.toFixed(2)}  (US$${monthly100USD.toFixed(4)})`
    );
    console.log(
      `  Pricing used       : input $${pricing.inputCostPer1M}/1 M tok,` +
        ` output $${pricing.outputCostPer1M}/1 M tok` +
        (pricing.isFallback ? ` (fallback: ${DEFAULT_BENCH_MODEL})` : '') +
        `,` +
        ` USD→INR ${pricing.usdToInr}`
    );
  }

  // ── Accuracy verdict ─────────────────────────────────────────────────────────

  console.log('\nAccuracy:');
  console.log(`  ${passCount}/${totalWithExpected} fixtures within expected score ranges`);

  const threshold = Math.ceil(totalWithExpected * 0.8); // 80 %
  const accuracyOk = passCount >= threshold;

  console.log('');
  if (!accuracyOk || !latencyOk) {
    if (!accuracyOk)
      console.error(
        `❌ ACCURACY: only ${passCount}/${totalWithExpected} pass (need ≥ ${threshold})`
      );
    if (!latencyOk)
      console.error(`❌ LATENCY:  p95 = ${p95} ms exceeds ${LATENCY_TARGET_MS} ms target`);
    process.exit(1);
  } else {
    console.log(
      `✅ BENCHMARK PASSED — ${passCount}/${totalWithExpected} fixtures pass, p95 = ${p95} ms`
    );
  }
}

export { main };

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Fatal: ${(err as Error).message}`);
    process.exit(1);
  });
}

