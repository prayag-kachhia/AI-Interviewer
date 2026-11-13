import { describe, it, expect } from 'vitest';
import {
  resolveBenchmarkPricing,
  calculateBenchmarkCost,
  checkTechnologyParity,
  evaluateTechnologyIndependence,
  KNOWN_MODEL_PRICING,
  DEFAULT_BENCH_MODEL,
} from '../../scripts/bench';

describe('Benchmark Pricing & Cost Calculation', () => {
  describe('resolveBenchmarkPricing', () => {
    it('resolves gemini-3.8-flash pricing by default', () => {
      const pricing = resolveBenchmarkPricing(undefined, {});
      expect(pricing.model).toBe('gemini-3.8-flash');
      expect(pricing.inputCostPer1M).toBe(0.75);
      expect(pricing.outputCostPer1M).toBe(3.75);
      expect(pricing.usdToInr).toBe(84.0);
      expect(pricing.isFallback).toBe(false);
    });

    it('resolves gemini-3.5-flash pricing when selected', () => {
      const pricing = resolveBenchmarkPricing('gemini-3.5-flash', {});
      expect(pricing.model).toBe('gemini-3.5-flash');
      expect(pricing.inputCostPer1M).toBe(1.5);
      expect(pricing.outputCostPer1M).toBe(9.0);
      expect(pricing.usdToInr).toBe(84.0);
      expect(pricing.isFallback).toBe(false);
    });

    it('resolves model from GEMINI_EVAL_MODEL env var if model param is omitted', () => {
      const pricing = resolveBenchmarkPricing(undefined, {
        GEMINI_EVAL_MODEL: 'gemini-3.5-flash',
      });
      expect(pricing.model).toBe('gemini-3.5-flash');
      expect(pricing.inputCostPer1M).toBe(1.5);
      expect(pricing.outputCostPer1M).toBe(9.0);
      expect(pricing.isFallback).toBe(false);
    });

    it('flags fallback pricing for unknown model IDs without explicit overrides', () => {
      const pricing = resolveBenchmarkPricing('unknown-model-xyz', {});
      expect(pricing.model).toBe('unknown-model-xyz');
      expect(pricing.isFallback).toBe(true);
      expect(pricing.inputCostPer1M).toBe(KNOWN_MODEL_PRICING[DEFAULT_BENCH_MODEL].inputCostPer1M);
      expect(pricing.outputCostPer1M).toBe(KNOWN_MODEL_PRICING[DEFAULT_BENCH_MODEL].outputCostPer1M);
    });

    it('does not flag fallback pricing if explicit overrides are provided for unknown models', () => {
      const pricing = resolveBenchmarkPricing('unknown-model-xyz', {
        BENCH_INPUT_COST_USD_PER_1M: '2.50',
        BENCH_OUTPUT_COST_USD_PER_1M: '12.00',
      });
      expect(pricing.model).toBe('unknown-model-xyz');
      expect(pricing.isFallback).toBe(false);
      expect(pricing.inputCostPer1M).toBe(2.5);
      expect(pricing.outputCostPer1M).toBe(12.0);
    });

    it('respects BENCH_INPUT_COST_USD_PER_1M and BENCH_OUTPUT_COST_USD_PER_1M overrides on known models', () => {
      const pricing = resolveBenchmarkPricing('gemini-3.8-flash', {
        BENCH_INPUT_COST_USD_PER_1M: '1.25',
        BENCH_OUTPUT_COST_USD_PER_1M: '5.50',
      });
      expect(pricing.inputCostPer1M).toBe(1.25);
      expect(pricing.outputCostPer1M).toBe(5.5);
      expect(pricing.isFallback).toBe(false);
    });

    it('respects BENCH_USD_TO_INR override', () => {
      const pricing = resolveBenchmarkPricing('gemini-3.8-flash', {
        BENCH_USD_TO_INR: '86.5',
      });
      expect(pricing.usdToInr).toBe(86.5);
    });
  });

  describe('calculateBenchmarkCost', () => {
    it('calculates expected costs for gemini-3.5-flash benchmark run (1080 in, 518 out)', () => {
      const pricing = resolveBenchmarkPricing('gemini-3.5-flash', {});
      const cost = calculateBenchmarkCost(1080, 518, pricing);

      // (1080 / 1e6) * 1.50 + (518 / 1e6) * 9.00 = 0.00162 + 0.004662 = 0.006282 USD
      expect(cost.costUSD).toBeCloseTo(0.006282, 6);
      // 0.006282 * 84 = 0.527688 INR (~0.5277 INR)
      expect(cost.costINR).toBeCloseTo(0.5277, 4);
      expect(cost.monthly100USD).toBeCloseTo(0.6282, 4);
      expect(cost.monthly100INR).toBeCloseTo(52.77, 2);
    });

    it('calculates expected costs for gemini-3.8-flash production estimate (1080 in, 518 out)', () => {
      const pricing = resolveBenchmarkPricing('gemini-3.8-flash', {});
      const cost = calculateBenchmarkCost(1080, 518, pricing);

      // (1080 / 1e6) * 0.75 + (518 / 1e6) * 3.75 = 0.00081 + 0.0019425 = 0.0027525 USD (~0.002753 USD)
      expect(cost.costUSD).toBeCloseTo(0.0027525, 6);
      // 0.0027525 * 84 = 0.23121 INR (~0.2312 INR)
      expect(cost.costINR).toBeCloseTo(0.2312, 4);
      expect(cost.monthly100USD).toBeCloseTo(0.2753, 4);
      expect(cost.monthly100INR).toBeCloseTo(23.12, 2);
    });
  });

  describe('checkTechnologyParity (PN-8, DR-05)', () => {
    it('passes when score difference is within 1.0 point', () => {
      const result = checkTechnologyParity(4.8, 4.3);
      expect(result.diff).toBe(0.5);
      expect(result.pass).toBe(true);
    });

    it('passes at exact 1.0 point difference boundary', () => {
      const result = checkTechnologyParity(5.0, 4.0);
      expect(result.diff).toBe(1.0);
      expect(result.pass).toBe(true);
    });

    it('fails when score difference exceeds 1.0 point', () => {
      const result = checkTechnologyParity(4.8, 3.2);
      expect(result.diff).toBe(1.6);
      expect(result.pass).toBe(false);
    });

    it('handles identical scores with zero difference', () => {
      const result = checkTechnologyParity(4.67, 4.67);
      expect(result.diff).toBe(0);
      expect(result.pass).toBe(true);
    });
  });

  describe('evaluateTechnologyIndependence (PN-8, DR-05)', () => {
    const makeRun = (score: number, error?: string) => ({
      wallMs: 1000,
      promptTokens: 100,
      outputTokens: 50,
      scores: error ? [] : [{ category: 'Problem Solving & Algorithms', score }],
      error,
    });

    it('passes when both fixtures exist and scores are within 1.0 point', () => {
      const results = [
        { name: 'tech-stack-python', runs: [makeRun(5), makeRun(4)] }, // avg 4.5
        { name: 'tech-stack-java', runs: [makeRun(4), makeRun(4)] },   // avg 4.0
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(true);
      expect(res.pyAvg).toBe(4.5);
      expect(res.javaAvg).toBe(4.0);
      expect(res.diff).toBe(0.5);
      expect(res.error).toBeUndefined();
    });

    it('fails when score difference exceeds 1.0 point', () => {
      const results = [
        { name: 'tech-stack-python', runs: [makeRun(5)] },
        { name: 'tech-stack-java', runs: [makeRun(3)] }, // diff 2.0
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(false);
      expect(res.diff).toBe(2.0);
    });

    it('fails when tech-stack-python fixture is missing', () => {
      const results = [
        { name: 'tech-stack-java', runs: [makeRun(4)] },
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Missing required technology stack fixture(s): tech-stack-python');
    });

    it('fails when tech-stack-java fixture is missing', () => {
      const results = [
        { name: 'tech-stack-python', runs: [makeRun(4)] },
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Missing required technology stack fixture(s): tech-stack-java');
    });

    it('fails when a fixture has only errored runs and no valid scores', () => {
      const results = [
        { name: 'tech-stack-python', runs: [makeRun(0, '429 rate limit')] },
        { name: 'tech-stack-java', runs: [makeRun(4)] },
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('No successful evaluated runs with scores for: tech-stack-python');
    });

    it('filters out errored runs and computes average from successful runs only', () => {
      const results = [
        { name: 'tech-stack-python', runs: [makeRun(0, '503 error'), makeRun(5)] },
        { name: 'tech-stack-java', runs: [makeRun(5), makeRun(0, 'timeout')] },
      ];
      const res = evaluateTechnologyIndependence(results);
      expect(res.pass).toBe(true);
      expect(res.pyAvg).toBe(5);
      expect(res.javaAvg).toBe(5);
      expect(res.diff).toBe(0);
    });
  });
});
