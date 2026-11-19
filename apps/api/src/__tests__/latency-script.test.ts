import { describe, it, expect } from 'vitest';
import {
  calculatePercentile,
  calculateLatencyStats,
  parseArgs,
} from '../../scripts/latency';

describe('Interviewer Response Latency Benchmark (VI-7, #146, NFR-01)', () => {
  describe('calculatePercentile', () => {
    it('returns 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
    });

    it('returns single element for length 1 array', () => {
      expect(calculatePercentile([1500], 50)).toBe(1500);
      expect(calculatePercentile([1500], 95)).toBe(1500);
    });

    it('computes nearest rank percentiles accurately', () => {
      // 10 sorted numbers: 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000
      const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      expect(calculatePercentile(values, 50)).toBe(500);
      expect(calculatePercentile(values, 90)).toBe(900);
      expect(calculatePercentile(values, 95)).toBe(1000);
    });
  });

  describe('calculateLatencyStats', () => {
    it('returns null when latency values array is empty', () => {
      expect(calculateLatencyStats([])).toBeNull();
    });

    it('calculates full statistics and marks meetsNfr01 true when p95 <= 5000ms and >= 95% under target', () => {
      // 20 turns: 19 fast (800ms - 2600ms), 1 slow (4200ms) - all <= 5000ms
      const latencies = [
        800, 950, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
        1900, 2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 4200,
      ];

      const stats = calculateLatencyStats(latencies, 5000);
      expect(stats).not.toBeNull();
      if (!stats) return;

      expect(stats.count).toBe(20);
      expect(stats.min).toBe(800);
      expect(stats.max).toBe(4200);
      expect(stats.p50).toBe(1800);
      expect(stats.p95).toBe(2700);
      expect(stats.underTargetCount).toBe(20);
      expect(stats.underTargetPct).toBe(100);
      expect(stats.meetsNfr01).toBe(true);
    });

    it('marks meetsNfr01 false when p95 exceeds 5000ms threshold', () => {
      // 20 turns with 2 severe latency spikes (> 5000ms)
      const latencies = [
        1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900,
        2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 5500, 6200,
      ];

      const stats = calculateLatencyStats(latencies, 5000);
      expect(stats).not.toBeNull();
      if (!stats) return;

      expect(stats.p95).toBe(5500);
      expect(stats.underTargetCount).toBe(18);
      expect(stats.underTargetPct).toBe(90);
      expect(stats.meetsNfr01).toBe(false);
    });
  });

  describe('parseArgs', () => {
    it('parses defaults', () => {
      const args = parseArgs([]);
      expect(args.limit).toBe(100);
      expect(args.targetMs).toBe(5000);
      expect(args.json).toBe(false);
    });

    it('parses custom flags', () => {
      const args = parseArgs(['--limit', '50', '--target', '3000', '--json']);
      expect(args.limit).toBe(50);
      expect(args.targetMs).toBe(3000);
      expect(args.json).toBe(true);
    });

    it('parses inline flag formats', () => {
      const args = parseArgs(['--limit=25', '--target=4000']);
      expect(args.limit).toBe(25);
      expect(args.targetMs).toBe(4000);
    });
  });
});
