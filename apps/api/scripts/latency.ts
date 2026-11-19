import prisma from '../src/db';

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  targetMs: number;
  underTargetCount: number;
  underTargetPct: number;
  meetsNfr01: boolean;
}

/**
 * Calculates a specific percentile from a sorted array of numbers using the nearest-rank method.
 */
export function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = Math.ceil((percentile / 100) * sortedValues.length);
  const index = Math.max(0, Math.min(sortedValues.length - 1, rank - 1));
  return sortedValues[index];
}

/**
 * Calculates comprehensive latency statistics against the NFR-01 target (5.0s = 5000ms).
 */
export function calculateLatencyStats(
  latencyValues: number[],
  targetMs = 5000
): LatencyStats | null {
  if (latencyValues.length === 0) {
    return null;
  }

  const sorted = [...latencyValues].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = Math.round(sum / count);
  const p50 = calculatePercentile(sorted, 50);
  const p90 = calculatePercentile(sorted, 90);
  const p95 = calculatePercentile(sorted, 95);

  const underTargetCount = sorted.filter((v) => v <= targetMs).length;
  const underTargetPct = Number(((underTargetCount / count) * 100).toFixed(1));
  const meetsNfr01 = p95 <= targetMs && underTargetPct >= 95;

  return {
    count,
    min,
    max,
    mean,
    p50,
    p90,
    p95,
    targetMs,
    underTargetCount,
    underTargetPct,
    meetsNfr01,
  };
}

export function parseArgs(argv: string[]) {
  let limit = 100;
  let targetMs = 5000;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') {
      const val = parseInt(argv[++i], 10);
      if (!isNaN(val) && val > 0) limit = val;
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.slice('--limit='.length), 10);
      if (!isNaN(val) && val > 0) limit = val;
    } else if (arg === '--target') {
      const val = parseInt(argv[++i], 10);
      if (!isNaN(val) && val > 0) targetMs = val;
    } else if (arg.startsWith('--target=')) {
      const val = parseInt(arg.slice('--target='.length), 10);
      if (!isNaN(val) && val > 0) targetMs = val;
    } else if (arg === '--json') {
      json = true;
    }
  }

  return { limit, targetMs, json };
}

export async function run() {
  const { limit, targetMs, json } = parseArgs(process.argv.slice(2));

  try {
    const turns = await prisma.turn.findMany({
      where: {
        speaker: 'AI',
        latencyMs: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        sessionId: true,
        turnIndex: true,
        latencyMs: true,
        createdAt: true,
      },
    });

    const latencies = (turns as Array<{ latencyMs: number | null }>)
      .map((t) => t.latencyMs)
      .filter((l): l is number => typeof l === 'number');

    const stats = calculateLatencyStats(latencies, targetMs);

    if (json) {
      console.log(JSON.stringify({ stats, turnsCount: turns.length }, null, 2));
      return;
    }

    console.log('\n======================================================');
    console.log('       INTERVIEWER VOICE RESPONSE LATENCY BENCHMARK   ');
    console.log('                 (NFR-01 / Issue #146)                ');
    console.log('======================================================\n');

    if (!stats) {
      console.log('No AI turns with recorded latency found in database.');
      console.log('AI voice turns record latencyMs from candidate turn completion to first audio chunk.');
      console.log('Complete a live voice session to measure empirical response latencies.\n');
      return;
    }

    console.log(`Analyzed AI Voice Turns : ${stats.count} (most recent up to ${limit})`);
    console.log(`Target Latency Threshold: <= ${stats.targetMs} ms (5.0 s per SRS NFR-01)\n`);

    console.log('Percentile Breakdown:');
    console.log(`  Min Response Time     : ${stats.min.toLocaleString()} ms`);
    console.log(`  Mean (Avg) Response   : ${stats.mean.toLocaleString()} ms`);
    console.log(`  p50 (Median) Latency  : ${stats.p50.toLocaleString()} ms`);
    console.log(`  p90 Latency           : ${stats.p90.toLocaleString()} ms`);
    console.log(`  p95 Latency           : ${stats.p95.toLocaleString()} ms`);
    console.log(`  Max Response Time     : ${stats.max.toLocaleString()} ms\n`);

    console.log('NFR-01 Compliance:');
    console.log(
      `  Turns within <= ${stats.targetMs / 1000}s : ${stats.underTargetCount} / ${stats.count} (${stats.underTargetPct}%)`
    );
    console.log(
      `  Status                : ${stats.meetsNfr01 ? 'PASSED ✅' : 'FAILED ❌'} (Target: p95 <= 5000 ms, >= 95%)\n`
    );
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2022') {
      if (json) {
        console.log(
          JSON.stringify({ error: 'MigrationPending', message: 'latencyMs column not present in database yet' }, null, 2)
        );
      } else {
        console.log('\n======================================================');
        console.log('       INTERVIEWER VOICE RESPONSE LATENCY BENCHMARK   ');
        console.log('                 (NFR-01 / Issue #146)                ');
        console.log('======================================================\n');
        console.log('Notice: Column `turns.latencyMs` is not yet applied to the connected database.');
        console.log('Run database migrations (`bun run db:migrate`) or deploy to Supabase to enable persistence.\n');
      }
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

// Only execute directly when run as CLI entry point
const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('latency.ts') || process.argv[1].endsWith('latency.js'));

if (isDirectExecution) {
  run().catch((err) => {
    console.error('Latency benchmark failed:', err);
    process.exit(1);
  });
}
