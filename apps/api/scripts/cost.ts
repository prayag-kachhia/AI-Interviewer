/**
 * Cost analysis script for AI Interviewer (S-8 / NFR-16 / OI-2).
 * Reads stored token usage from the Feedback table, calculates actual infrastructure
 * cost per completed interview in USD and INR, and models projected Gemini Live audio costs.
 *
 * Usage:
 *   bun scripts/cost.ts
 *   bun scripts/cost.ts --limit 50
 *   bun scripts/cost.ts --simulate
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Prisma } from '../src/generated/prisma/client';
import type { StoredFeedbackUsage } from '../src/services/feedback.service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Unconditionally load .env without overriding existing process.env variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export interface PricingConfig {
  model: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  usdToInr: number;
}

export interface LiveAudioEstimateConfig {
  model: string;
  audioInputPer1M: number;
  audioOutputPer1M: number;
  totalMinutes: number;
  candidateMinutes: number;
  interviewerMinutes: number;
  tokensPerSecInput: number;
  tokensPerSecOutput: number;
}

/**
 * Published rate card from Google AI Studio / Gemini Developer API:
 * Official documentation: https://ai.google.dev/pricing
 */
export const DEFAULT_PRICING: PricingConfig = {
  model: 'gemini-3.8-flash',
  inputCostPer1M: 0.75, // $0.75 / 1M prompt tokens (introductory rate through 2026-12-31)
  outputCostPer1M: 3.75, // $3.75 / 1M output tokens (includes thinking tokens)
  usdToInr: 84.0, // Benchmark standard conversion rate
};

export const KNOWN_MODEL_PRICING: Record<string, { inputCostPer1M: number; outputCostPer1M: number }> = {
  'gemini-3.8-flash': { inputCostPer1M: 0.75, outputCostPer1M: 3.75 },
};

/**
 * Published Multimodal Live API rate card and conversational duration model:
 * Official documentation: https://ai.google.dev/pricing
 * Note: Conversational audio streams directly between browser and Google over WebSocket.
 * The 15-minute duration breakdown is a projection based on conversational turns.
 */
export const DEFAULT_LIVE_AUDIO_CONFIG: LiveAudioEstimateConfig = {
  model: 'gemini-3.8-live',
  audioInputPer1M: 3.0, // $3.00 / 1M audio tokens (published rate)
  audioOutputPer1M: 12.0, // $12.00 / 1M audio tokens (published rate)
  totalMinutes: 15,
  candidateMinutes: 10, // ~67% candidate speech time
  interviewerMinutes: 5, // ~33% AI interviewer questions and follow-ups
  tokensPerSecInput: 25, // ~25 audio tokens per second
  tokensPerSecOutput: 25, // ~25 audio tokens per second
};

function parsePositiveRate(val: string | undefined, varName: string): number | undefined {
  if (val === undefined || val.trim() === '') {
    return undefined;
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(
      `Invalid pricing configuration for ${varName}: "${val}". Must be a non-negative finite number.`
    );
  }
  return num;
}

function parsePositiveExchangeRate(val: string | undefined, varName: string): number | undefined {
  if (val === undefined || val.trim() === '') {
    return undefined;
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(
      `Invalid exchange rate configuration for ${varName}: "${val}". Must be a positive finite number.`
    );
  }
  return num;
}

export function resolvePricingConfig(env: NodeJS.ProcessEnv = process.env): PricingConfig {
  const model = env.GEMINI_EVAL_MODEL?.trim() || DEFAULT_PRICING.model;

  const customInputRate = parsePositiveRate(env.BENCH_INPUT_COST_USD_PER_1M, 'BENCH_INPUT_COST_USD_PER_1M');
  const customOutputRate = parsePositiveRate(env.BENCH_OUTPUT_COST_USD_PER_1M, 'BENCH_OUTPUT_COST_USD_PER_1M');
  const customUsdToInr = parsePositiveExchangeRate(env.BENCH_USD_TO_INR, 'BENCH_USD_TO_INR');

  const known = KNOWN_MODEL_PRICING[model];
  if (!known) {
    if (customInputRate === undefined || customOutputRate === undefined) {
      throw new Error(
        `Unsupported pricing model "${model}": no verified rate card available. ` +
        `Provide custom rates via BENCH_INPUT_COST_USD_PER_1M and BENCH_OUTPUT_COST_USD_PER_1M, ` +
        `or use supported model: ${Object.keys(KNOWN_MODEL_PRICING).join(', ')}`
      );
    }
  }

  const inputCostPer1M = customInputRate !== undefined ? customInputRate : known!.inputCostPer1M;
  const outputCostPer1M = customOutputRate !== undefined ? customOutputRate : known!.outputCostPer1M;
  const usdToInr = customUsdToInr !== undefined ? customUsdToInr : DEFAULT_PRICING.usdToInr;

  return {
    model,
    inputCostPer1M,
    outputCostPer1M,
    usdToInr,
  };
}

export function calculateTokenCost(
  promptTokens: number,
  outputTokens: number,
  pricing: PricingConfig = DEFAULT_PRICING
): { costUSD: number; costINR: number } {
  const costUSD =
    (promptTokens / 1_000_000) * pricing.inputCostPer1M +
    (outputTokens / 1_000_000) * pricing.outputCostPer1M;
  const costINR = costUSD * pricing.usdToInr;
  return { costUSD, costINR };
}

export function calculateLiveAudioEstimate(
  audioConfig: LiveAudioEstimateConfig = DEFAULT_LIVE_AUDIO_CONFIG,
  usdToInr = DEFAULT_PRICING.usdToInr
): {
  candidateAudioTokens: number;
  interviewerAudioTokens: number;
  totalAudioTokens: number;
  candidateCostUSD: number;
  interviewerCostUSD: number;
  totalCostUSD: number;
  totalCostINR: number;
  isProjectedEstimate: true;
} {
  const candidateAudioTokens = audioConfig.candidateMinutes * 60 * audioConfig.tokensPerSecInput;
  const interviewerAudioTokens = audioConfig.interviewerMinutes * 60 * audioConfig.tokensPerSecOutput;
  const totalAudioTokens = candidateAudioTokens + interviewerAudioTokens;

  const candidateCostUSD = (candidateAudioTokens / 1_000_000) * audioConfig.audioInputPer1M;
  const interviewerCostUSD = (interviewerAudioTokens / 1_000_000) * audioConfig.audioOutputPer1M;
  const totalCostUSD = candidateCostUSD + interviewerCostUSD;
  const totalCostINR = totalCostUSD * usdToInr;

  return {
    candidateAudioTokens,
    interviewerAudioTokens,
    totalAudioTokens,
    candidateCostUSD,
    interviewerCostUSD,
    totalCostUSD,
    totalCostINR,
    isProjectedEstimate: true,
  };
}

export interface InterviewCostSummary {
  evaluator: { promptTokens: number; outputTokens: number; costUSD: number; costINR: number };
  nextQuestion: { promptTokens: number; outputTokens: number; callCount: number; costUSD: number; costINR: number };
  textTotal: { promptTokens: number; outputTokens: number; totalTokens: number; costUSD: number; costINR: number };
  liveAudioEstimate: ReturnType<typeof calculateLiveAudioEstimate>;
  grandTotalUSD: number;
  grandTotalINR: number;
  proposedCeilingINR: number;
  isWithinProposedCeiling: boolean;
}

export function calculateInterviewCost(
  usage: StoredFeedbackUsage | null | undefined,
  pricing: PricingConfig = DEFAULT_PRICING,
  audioConfig: LiveAudioEstimateConfig = DEFAULT_LIVE_AUDIO_CONFIG
): InterviewCostSummary {
  const evalPrompt = usage?.evaluator?.promptTokens ?? 0;
  const evalOutput = usage?.evaluator?.outputTokens ?? 0;
  const evalCost = calculateTokenCost(evalPrompt, evalOutput, pricing);

  const nqPrompt = usage?.nextQuestion?.promptTokens ?? 0;
  const nqOutput = usage?.nextQuestion?.outputTokens ?? 0;
  const nqCallCount = usage?.nextQuestion?.callCount ?? 0;
  const nqCost = calculateTokenCost(nqPrompt, nqOutput, pricing);

  const textTotalPrompt = evalPrompt + nqPrompt;
  const textTotalOutput = evalOutput + nqOutput;
  const textCost = calculateTokenCost(textTotalPrompt, textTotalOutput, pricing);

  const liveAudio = calculateLiveAudioEstimate(audioConfig, pricing.usdToInr);

  const grandTotalUSD = textCost.costUSD + liveAudio.totalCostUSD;
  const grandTotalINR = textCost.costINR + liveAudio.totalCostINR;
  const proposedCeilingINR = 25.0; // Proposed budget ceiling for OI-2 / NFR-16

  return {
    evaluator: { promptTokens: evalPrompt, outputTokens: evalOutput, ...evalCost },
    nextQuestion: { promptTokens: nqPrompt, outputTokens: nqOutput, callCount: nqCallCount, ...nqCost },
    textTotal: {
      promptTokens: textTotalPrompt,
      outputTokens: textTotalOutput,
      totalTokens: textTotalPrompt + textTotalOutput,
      ...textCost,
    },
    liveAudioEstimate: liveAudio,
    grandTotalUSD,
    grandTotalINR,
    proposedCeilingINR,
    isWithinProposedCeiling: grandTotalINR <= proposedCeilingINR,
  };
}

export function isValidStoredUsage(u: unknown): u is StoredFeedbackUsage {
  if (!u || typeof u !== 'object' || Array.isArray(u)) {
    return false;
  }
  const obj = u as Record<string, any>;

  // Top-level token counts must be finite non-negative numbers
  if (
    typeof obj.promptTokens !== 'number' ||
    !Number.isFinite(obj.promptTokens) ||
    obj.promptTokens < 0 ||
    typeof obj.outputTokens !== 'number' ||
    !Number.isFinite(obj.outputTokens) ||
    obj.outputTokens < 0 ||
    typeof obj.totalTokens !== 'number' ||
    !Number.isFinite(obj.totalTokens) ||
    obj.totalTokens < 0
  ) {
    return false;
  }

  // Nested evaluator must be present with valid token counts
  if (
    !obj.evaluator ||
    typeof obj.evaluator !== 'object' ||
    Array.isArray(obj.evaluator) ||
    typeof obj.evaluator.promptTokens !== 'number' ||
    !Number.isFinite(obj.evaluator.promptTokens) ||
    obj.evaluator.promptTokens < 0 ||
    typeof obj.evaluator.outputTokens !== 'number' ||
    !Number.isFinite(obj.evaluator.outputTokens) ||
    obj.evaluator.outputTokens < 0 ||
    typeof obj.evaluator.totalTokens !== 'number' ||
    !Number.isFinite(obj.evaluator.totalTokens) ||
    obj.evaluator.totalTokens < 0
  ) {
    return false;
  }

  // Nested nextQuestion must be present with valid token counts and callCount
  if (
    !obj.nextQuestion ||
    typeof obj.nextQuestion !== 'object' ||
    Array.isArray(obj.nextQuestion) ||
    typeof obj.nextQuestion.promptTokens !== 'number' ||
    !Number.isFinite(obj.nextQuestion.promptTokens) ||
    obj.nextQuestion.promptTokens < 0 ||
    typeof obj.nextQuestion.outputTokens !== 'number' ||
    !Number.isFinite(obj.nextQuestion.outputTokens) ||
    obj.nextQuestion.outputTokens < 0 ||
    typeof obj.nextQuestion.totalTokens !== 'number' ||
    !Number.isFinite(obj.nextQuestion.totalTokens) ||
    obj.nextQuestion.totalTokens < 0 ||
    typeof obj.nextQuestion.callCount !== 'number' ||
    !Number.isFinite(obj.nextQuestion.callCount) ||
    obj.nextQuestion.callCount < 0
  ) {
    return false;
  }

  return true;
}

export function aggregateFeedbackUsage(records: Array<{ usage: unknown }>): {
  count: number;
  averageUsage: StoredFeedbackUsage;
  excludedCount: number;
} {
  const validRecords: StoredFeedbackUsage[] = [];
  let excludedCount = 0;

  for (const r of records) {
    if (isValidStoredUsage(r.usage)) {
      validRecords.push(r.usage);
    } else {
      excludedCount++;
    }
  }

  if (validRecords.length === 0) {
    return {
      count: 0,
      averageUsage: {
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        evaluator: { promptTokens: 0, outputTokens: 0, totalTokens: 0 },
        nextQuestion: { promptTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0 },
      },
      excludedCount,
    };
  }

  const sum = validRecords.reduce(
    (acc, cur) => {
      acc.evalPrompt += cur.evaluator!.promptTokens;
      acc.evalOutput += cur.evaluator!.outputTokens;
      acc.nqPrompt += cur.nextQuestion!.promptTokens;
      acc.nqOutput += cur.nextQuestion!.outputTokens;
      acc.nqCalls += cur.nextQuestion!.callCount;
      return acc;
    },
    { evalPrompt: 0, evalOutput: 0, nqPrompt: 0, nqOutput: 0, nqCalls: 0 }
  );

  const n = validRecords.length;
  const avgEvalPrompt = Math.round(sum.evalPrompt / n);
  const avgEvalOutput = Math.round(sum.evalOutput / n);
  const avgNqPrompt = Math.round(sum.nqPrompt / n);
  const avgNqOutput = Math.round(sum.nqOutput / n);
  const avgNqCalls = Math.round((sum.nqCalls / n) * 10) / 10;

  const totalPrompt = avgEvalPrompt + avgNqPrompt;
  const totalOutput = avgEvalOutput + avgNqOutput;

  return {
    count: n,
    averageUsage: {
      promptTokens: totalPrompt,
      outputTokens: totalOutput,
      totalTokens: totalPrompt + totalOutput,
      evaluator: {
        promptTokens: avgEvalPrompt,
        outputTokens: avgEvalOutput,
        totalTokens: avgEvalPrompt + avgEvalOutput,
      },
      nextQuestion: {
        promptTokens: avgNqPrompt,
        outputTokens: avgNqOutput,
        totalTokens: avgNqPrompt + avgNqOutput,
        callCount: Math.round(avgNqCalls),
      },
    },
    excludedCount,
  };
}

export function parseArgs(args: string[] = process.argv.slice(2)): { limit?: number; simulate?: boolean } {
  const result: { limit?: number; simulate?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit' && i + 1 < args.length) {
      const parsed = parseInt(args[i + 1], 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        result.limit = parsed;
        i++;
      } else {
        throw new Error(`Invalid --limit value: "${args[i + 1]}". Must be a positive integer.`);
      }
    } else if (arg.startsWith('--limit=')) {
      const val = arg.split('=')[1];
      const parsed = parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        result.limit = parsed;
      } else {
        throw new Error(`Invalid --limit value: "${val}". Must be a positive integer.`);
      }
    } else if (arg === '--simulate') {
      result.simulate = true;
    }
  }
  return result;
}

// ── CLI Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const pricing = resolvePricingConfig();
  const audioConfig = DEFAULT_LIVE_AUDIO_CONFIG;

  console.log('═'.repeat(80));
  console.log('  AI INTERVIEWER — GEMINI COST PER INTERVIEW (NFR-16 / S-8)');
  console.log('═'.repeat(80));
  console.log(`Configured Text Model : ${pricing.model}`);
  console.log(`Rates Source          : Official Published Rate Card (https://ai.google.dev/pricing)`);
  console.log(`Prompt / Output Rate  : $${pricing.inputCostPer1M.toFixed(2)} / $${pricing.outputCostPer1M.toFixed(2)} per 1M tokens`);
  console.log(`USD to INR Exchange   : ₹${pricing.usdToInr.toFixed(2)}`);
  if (args.limit) {
    console.log(`Record Fetch Limit    : ${args.limit} completed sessions`);
  }
  console.log('─'.repeat(80));

  let records: Array<{ usage: unknown }> = [];
  let dbQueried = false;

  if (args.simulate) {
    console.log(`Mode                  : Explicit --simulate flag requested.`);
  } else if (!process.env.DATABASE_URL) {
    console.error(`[Error]: DATABASE_URL is not set. Run with --simulate to view modeled benchmark estimates, or configure DATABASE_URL.`);
    process.exit(1);
  } else {
    try {
      const { default: prisma } = await import('../src/db');
      records = await prisma.feedback.findMany({
        where: {
          status: 'ready',
          session: { status: 'ENDED' },
          usage: { not: Prisma.JsonNullValueFilter.AnyNull },
        },
        select: { usage: true },
        orderBy: { createdAt: 'desc' },
        ...(args.limit ? { take: args.limit } : {}),
      });
      dbQueried = true;
    } catch (err) {
      console.error(`[Database query error]: Failed to query feedback usage records: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const { count, averageUsage, excludedCount } = aggregateFeedbackUsage(records);

  let usageToReport: StoredFeedbackUsage;
  let isMeasured: boolean;

  if (dbQueried && count > 0) {
    isMeasured = true;
    usageToReport = averageUsage;
    const isTestDb = Boolean(
      process.env.DATABASE_URL?.includes('test') ||
      process.env.NODE_ENV === 'test'
    );
    const sourceLabel = isTestDb ? '[MEASURED TEST DATABASE DATA]' : '[MEASURED DATABASE DATA]';
    console.log(`Source                : ${sourceLabel} Based on ${count} completed interview records`);
    if (excludedCount > 0) {
      console.log(`                        (${excludedCount} records excluded due to incomplete or malformed usage structures)`);
    }
  } else {
    isMeasured = false;
    if (dbQueried) {
      console.log(`Source                : [DATABASE QUERY: 0 ELIGIBLE RECORDS] Database query succeeded, but 0 eligible completed`);
      console.log(`                        interview records with usage were found.`);
      console.log(`Fallback Mode         : [MODELED ESTIMATE] Displaying modeled token usage from benchmark fixtures`);
      console.log(`                        (modeled estimates are not measured from database records).`);
    } else {
      console.log(`Source                : [EXPLICIT SIMULATION MODE] --simulate flag requested.`);
      console.log(`                        Displaying modeled token usage from benchmark fixtures.`);
    }

    // Benchmark simulation default (modeled on representative 4-question session + evaluator)
    usageToReport = {
      promptTokens: 3250,
      outputTokens: 810,
      totalTokens: 4060,
      evaluator: {
        promptTokens: 1450,
        outputTokens: 510,
        totalTokens: 1960,
      },
      nextQuestion: {
        promptTokens: 1800,
        outputTokens: 300,
        totalTokens: 2100,
        callCount: 4,
      },
    };
  }

  const cost = calculateInterviewCost(usageToReport, pricing, audioConfig);

  console.log('\n' + '─'.repeat(80));
  console.log(`1. LLM TEXT TOKENS PER INTERVIEW ${isMeasured ? '(Actual Measured Averages)' : '(Modeled Estimate)'}`);
  console.log('─'.repeat(80));
  console.log(`  • Evaluation (evaluateTranscript)   : ${usageToReport.evaluator?.promptTokens.toLocaleString()} in, ${usageToReport.evaluator?.outputTokens.toLocaleString()} out`);
  console.log(`      Cost : $${cost.evaluator.costUSD.toFixed(6)}  (₹${cost.evaluator.costINR.toFixed(4)})`);
  console.log(`  • Next-Question (${usageToReport.nextQuestion?.callCount ?? 0} calls/interview) : ${usageToReport.nextQuestion?.promptTokens.toLocaleString()} in, ${usageToReport.nextQuestion?.outputTokens.toLocaleString()} out`);
  console.log(`      Cost : $${cost.nextQuestion.costUSD.toFixed(6)}  (₹${cost.nextQuestion.costINR.toFixed(4)})`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────────`);
  console.log(`  Subtotal LLM Text Cost              : $${cost.textTotal.costUSD.toFixed(6)}  (₹${cost.textTotal.costINR.toFixed(4)})`);

  console.log('\n' + '─'.repeat(80));
  console.log('2. PROJECTED 15-MINUTE GEMINI LIVE AUDIO (gemini-3.8-live)');
  console.log('   [UNVERIFIED AS FIXED CHARGE — PROJECTED FROM PUBLISHED TOKEN RATES]');
  console.log('   Rate card: $3.00/1M audio input, $12.00/1M audio output (https://ai.google.dev/pricing)');
  console.log('─'.repeat(80));
  console.log(`  • Candidate speech (~${audioConfig.candidateMinutes} min input)     : ~${cost.liveAudioEstimate.candidateAudioTokens.toLocaleString()} audio tok -> $${cost.liveAudioEstimate.candidateCostUSD.toFixed(4)} (₹${(cost.liveAudioEstimate.candidateCostUSD * pricing.usdToInr).toFixed(2)})`);
  console.log(`  • Interviewer speech (~${audioConfig.interviewerMinutes} min output)   : ~${cost.liveAudioEstimate.interviewerAudioTokens.toLocaleString()} audio tok -> $${cost.liveAudioEstimate.interviewerCostUSD.toFixed(4)} (₹${(cost.liveAudioEstimate.interviewerCostUSD * pricing.usdToInr).toFixed(2)})`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────────`);
  console.log(`  Subtotal Projected Audio Cost       : $${cost.liveAudioEstimate.totalCostUSD.toFixed(4)}  (₹${cost.liveAudioEstimate.totalCostINR.toFixed(2)})`);

  console.log('\n' + '─'.repeat(80));
  console.log('3. COMBINED COST SUMMARY PER COMPLETED INTERVIEW');
  console.log('─'.repeat(80));
  console.log(`  Text & Evaluation Cost              : ₹${cost.textTotal.costINR.toFixed(2)}  ($${cost.textTotal.costUSD.toFixed(4)})`);
  console.log(`  Projected 15-min Live Audio Cost    : ₹${cost.liveAudioEstimate.totalCostINR.toFixed(2)}  ($${cost.liveAudioEstimate.totalCostUSD.toFixed(4)})`);
  console.log(`  ──────────────────────────────────────────────────────────────────────────────`);
  console.log(`  Total Estimated Cost per Interview  : ₹${cost.grandTotalINR.toFixed(2)}  ($${cost.grandTotalUSD.toFixed(4)})`);

  console.log('\n' + '─'.repeat(80));
  console.log('4. PROPOSED PER-SESSION BUDGET CEILING (OI-2 / NFR-16)');
  console.log('─'.repeat(80));
  console.log(`  Proposed Funding Ceiling            : ₹${cost.proposedCeilingINR.toFixed(2)} per interview`);
  console.log(`  Headroom Buffer                     : ~${Math.round(((cost.proposedCeilingINR - cost.grandTotalINR) / cost.grandTotalINR) * 100)}% above standard 15-min session`);
  console.log(`  Status vs Ceiling                   : ${cost.isWithinProposedCeiling ? '✅ Within proposed ceiling' : '❌ Exceeds ceiling'}`);
  console.log(`  Note                                : Operational budget target; not an enforced programmatic cutoff.`);
  console.log('═'.repeat(80) + '\n');
}

if (import.meta.main) {
  main()
    .catch((err) => {
      console.error(`Fatal: ${(err as Error).message}`);
      process.exit(1);
    })
    .finally(async () => {
      try {
        const { default: prisma } = await import('../src/db');
        await prisma.$disconnect();
      } catch {}
    });
}
