import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import {
  resolveBenchmarkPricing,
  calculateBenchmarkCost,
  checkTechnologyParity,
  evaluateTechnologyIndependence,
  evaluateDifficultyAwareness,
  validateFixtureAgainstExpected,
  evaluateScoreSpread,
  runWithRetry,
  parseRetryAfterMs,
  MAX_RETRY_WAIT_MS,
  ExcessiveRetryDelayError,
  computeFixtureFingerprint,
  isValidCachedFixture,
  isValidCachedRun,
  filterValidCachedRuns,
  loadBenchCache,
  saveBenchCache,
  type RunResult,
  type FixtureResult,
  type FixtureExpected,
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

  describe('evaluateDifficultyAwareness (PN-3, DR-05)', () => {
    const makeRun = (score: number, error?: string, categories?: string[]) => {
      const cats = categories ?? [
        'Problem Solving & Algorithms',
        'Software Design & Architecture',
        'Technical Communication',
      ];
      return {
        wallMs: 1000,
        promptTokens: 100,
        outputTokens: 50,
        scores: error ? [] : cats.map((category) => ({ category, score })),
        error,
      };
    };

    it('passes when basic fixture achieves full marks 5/5 and advanced meets expectations', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(5), makeRun(5)] },
        { name: 'difficulty-advanced', runs: [makeRun(5), makeRun(4)] }, // avg 4.5
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(true);
      expect(res.basicAvg).toBe(5.0);
      expect(res.advancedAvg).toBe(4.5);
      expect(res.error).toBeUndefined();
    });

    it('fails when basic fixture receives less than full marks (penalized for lacking advanced depth)', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(4)] }, // scored 4/5 instead of 5/5
        { name: 'difficulty-advanced', runs: [makeRun(5)] },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Basic question did not achieve full marks (5/5)');
    });

    it('fails when difficulty-basic fixture is missing', () => {
      const results = [
        { name: 'difficulty-advanced', runs: [makeRun(5)] },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Missing required difficulty benchmark fixture(s): difficulty-basic');
    });

    it('fails when difficulty-advanced fixture is missing', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(5)] },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Missing required difficulty benchmark fixture(s): difficulty-advanced');
    });

    it('fails when a fixture has only errored runs and no valid scores', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(0, '503 error')] },
        { name: 'difficulty-advanced', runs: [makeRun(5)] },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('No successful evaluated runs with scores for: difficulty-basic');
    });

    it('fails when advanced fixture average drops below 4.0', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(5)] },
        { name: 'difficulty-advanced', runs: [makeRun(3)] }, // avg 3.0 < 4.0
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('fell below expectations');
    });

    it('fails when difficulty-basic is missing an expected rubric category (Task 5)', () => {
      const results = [
        {
          name: 'difficulty-basic',
          runs: [makeRun(5, undefined, ['Problem Solving & Algorithms', 'Technical Communication'])], // Missing Software Design & Architecture
        },
        { name: 'difficulty-advanced', runs: [makeRun(5)] },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Basic fixture missing required rubric category/categories: Software Design & Architecture');
    });

    it('fails when difficulty-advanced is missing an expected rubric category (Task 5)', () => {
      const results = [
        { name: 'difficulty-basic', runs: [makeRun(5)] },
        {
          name: 'difficulty-advanced',
          runs: [makeRun(5, undefined, ['Problem Solving & Algorithms'])], // Missing Software Design & Architecture and Technical Communication
        },
      ];
      const res = evaluateDifficultyAwareness(results);
      expect(res.pass).toBe(false);
      expect(res.error).toContain('Advanced fixture missing required rubric category/categories: Software Design & Architecture, Technical Communication');
    });
  });

  describe('Benchmark Fixture Validation Logic (PN-4)', () => {
    it('passes when all category averages fall within expected min-max ranges', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 5 },
            { category: 'Data Interpretation & Business Insights', score: 4 },
            { category: 'Statistical Understanding & Data Quality', score: 5 },
          ],
        },
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 4 },
            { category: 'Data Interpretation & Business Insights', score: 4 },
            { category: 'Statistical Understanding & Data Quality', score: 4 },
          ],
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 4, max: 5 },
          { category: 'Data Interpretation & Business Insights', min: 4, max: 5 },
          { category: 'Statistical Understanding & Data Quality', min: 4, max: 5 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(true);
      expect(result.failReasons).toHaveLength(0);
    });

    it('fails when a category score average is below the expected minimum', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 3 },
            { category: 'Data Interpretation & Business Insights', score: 4 },
          ],
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 4, max: 5 },
          { category: 'Data Interpretation & Business Insights', min: 4, max: 5 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(false);
      expect(result.failReasons[0]).toContain('outside [4–5]');
    });

    it('fails when a category score average is above the expected maximum', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 4 },
            { category: 'Data Interpretation & Business Insights', score: 3 },
          ],
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 1, max: 2 },
          { category: 'Data Interpretation & Business Insights', min: 1, max: 2 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(false);
      expect(result.failReasons[0]).toContain('outside [1–2]');
    });

    it('fails when an expected category is completely missing from all evaluated runs', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 4 },
          ],
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 4, max: 5 },
          { category: 'Data Interpretation & Business Insights', min: 4, max: 5 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(false);
      expect(result.failReasons[0]).toContain('missing from all runs');
    });

    it('fails when an expected category is missing from only one of multiple successful runs', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 5 },
            { category: 'Data Interpretation & Business Insights', score: 5 },
          ],
        },
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 4 },
            // Data Interpretation & Business Insights is missing from run 2
          ],
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 4, max: 5 },
          { category: 'Data Interpretation & Business Insights', min: 4, max: 5 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(false);
      expect(
        result.failReasons.some((r) =>
          r.includes('missing from 1 of 2 successful run(s)')
        )
      ).toBe(true);
    });

    it('fails when all runs error out', () => {
      const runs = [
        { scores: [], error: '503 Service Unavailable' },
        { scores: [], error: 'Timeout after 30000ms' },
      ];
      const expected = {
        scores: [{ category: 'SQL & Analytical Reasoning', min: 4, max: 5 }],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(false);
      expect(result.failReasons).toContain('All runs errored');
    });

    it('excludes errored runs from score validation when at least one run succeeds', () => {
      const runs = [
        {
          scores: [
            { category: 'SQL & Analytical Reasoning', score: 5 },
            { category: 'Data Interpretation & Business Insights', score: 5 },
          ],
          error: undefined,
        },
        {
          scores: [],
          error: '503 Service Unavailable',
        },
      ];
      const expected = {
        scores: [
          { category: 'SQL & Analytical Reasoning', min: 4, max: 5 },
          { category: 'Data Interpretation & Business Insights', min: 4, max: 5 },
        ],
      };

      const result = validateFixtureAgainstExpected(runs, expected);
      expect(result.pass).toBe(true);
      expect(result.failReasons).toHaveLength(0);
    });
  });

  describe('S-7 — Score spread and consistency evaluation (NFR-19)', () => {
    const sweCategories = [
      'Problem Solving & Algorithms',
      'Software Design & Architecture',
      'Technical Communication',
    ];

    function makeSpreadRun(
      scoresMap: Record<string, number>,
      error?: string
    ): RunResult {
      return {
        wallMs: 1200,
        promptTokens: 800,
        outputTokens: 400,
        scores: Object.entries(scoresMap).map(([category, score]) => ({ category, score })),
        error,
      };
    }

    const standardExpected: FixtureExpected = {
      role: 'software-engineer',
      scores: sweCategories.map((cat) => ({ category: cat, min: 1, max: 5, reason: '' })),
    };

    it('passes when all categories across 5 runs have spread <= 1.0', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 3, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 3, 'Technical Communication': 5 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 3, 'Technical Communication': 5 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(true);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.exceededFixtures).toHaveLength(0);
      expect(res.inconclusiveFixtures).toHaveLength(0);
      expect(res.fixtureResults[0].status).toBe('PASS');
      expect(res.fixtureResults[0].maxSpread).toBe(1.0);
    });

    it('fails with status FAIL (genuine spread failure) when any category spread > 1.0', () => {
      // Problem Solving ranges from 3 to 5 (spread = 2.0 > 1.0)
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 3, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('FAIL');
      expect(res.fixtureResults[0].failureReason).toContain('Spread exceeded threshold');
      expect(res.exceededFixtures).toEqual([
        { fixtureName: 'good', category: 'Problem Solving & Algorithms', spread: 2.0 },
      ]);
      expect(res.inconclusiveFixtures).toHaveLength(0);
    });

    it('fails as INCONCLUSIVE when runs are fewer than requested (e.g. 4 of 5 runs)', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread(
        [{ name: 'good', role: 'Software Engineer', runs, expected: standardExpected }],
        { requestedRuns: 5 }
      );
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('Expected exactly 5 runs, but received 4');
      expect(res.fixtureResults[0].categories).toHaveLength(0);
      expect(res.inconclusiveFixtures).toHaveLength(1);
      expect(res.exceededFixtures).toHaveLength(0);
    });

    it('fails as INCONCLUSIVE when extra runs are provided (e.g. 6 of 5 runs)', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread(
        [{ name: 'good', role: 'Software Engineer', runs, expected: standardExpected }],
        { requestedRuns: 5 }
      );
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('Expected exactly 5 runs, but received 6');
      expect(res.fixtureResults[0].categories).toHaveLength(0);
      expect(res.inconclusiveFixtures).toHaveLength(1);
      expect(res.exceededFixtures).toHaveLength(0);
    });

    it('fails as INCONCLUSIVE when any run encountered an error', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({}, '503 Service Unavailable'),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('1 of 5 runs encountered errors');
      expect(res.fixtureResults[0].categories).toHaveLength(0);
      expect(res.inconclusiveFixtures).toHaveLength(1);
    });

    it('fails as INCONCLUSIVE when a category is missing from a run', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Technical Communication': 4 }), // Missing Software Design & Architecture
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'Run 2 is missing expected category: "Software Design & Architecture"'
      );
      expect(res.fixtureResults[0].categories).toHaveLength(0);
    });

    it('fails as INCONCLUSIVE when a category is duplicated in a run', () => {
      const duplicatedRun: RunResult = {
        wallMs: 1000,
        promptTokens: 500,
        outputTokens: 200,
        scores: [
          { category: 'Problem Solving & Algorithms', score: 4 },
          { category: 'Problem Solving & Algorithms', score: 5 }, // Duplicate
          { category: 'Software Design & Architecture', score: 4 },
          { category: 'Technical Communication', score: 4 },
        ],
      };

      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        duplicatedRun,
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'Run 2 has duplicated category: "Problem Solving & Algorithms"'
      );
    });

    it('fails as INCONCLUSIVE when a run contains an unexpected extra category', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({
          'Problem Solving & Algorithms': 4,
          'Software Design & Architecture': 4,
          'Technical Communication': 4,
          'Random Category': 5,
        }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'Run 2 contains unexpected category: "Random Category"'
      );
    });

    it('fails as INCONCLUSIVE when a score is out of the 1–5 range', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 6, 'Software Design & Architecture': 4, 'Technical Communication': 4 }), // score 6 > 5
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'Run 2 has invalid score for "Problem Solving & Algorithms": 6'
      );
    });

    it('fails as INCONCLUSIVE when a score is NaN or non-finite', () => {
      const runs = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': NaN, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'Run 2 has invalid score for "Problem Solving & Algorithms": NaN'
      );
    });

    it('fails as INCONCLUSIVE when a fixture has zero rubric categories or missing expected rubric', () => {
      const emptyExpected: FixtureExpected = { role: 'software-engineer', scores: [] };
      const runs = [
        makeSpreadRun({}),
        makeSpreadRun({}),
        makeSpreadRun({}),
        makeSpreadRun({}),
        makeSpreadRun({}),
      ];

      const res = evaluateScoreSpread([
        { name: 'empty', role: 'Software Engineer', runs, expected: emptyExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('zero categories defined');

      const resNoExpected = evaluateScoreSpread([
        { name: 'no-expected', role: 'Software Engineer', runs, expected: undefined },
      ]);
      expect(resNoExpected.pass).toBe(false);
      expect(resNoExpected.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(resNoExpected.fixtureResults[0].inconclusiveReason).toContain('missing or has zero categories defined');
    });

    it('correctly tracks multiple fixtures distinguishing PASS, FAIL (spread > 1.0), and INCONCLUSIVE', () => {
      const passingRuns = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 5, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const failingRuns = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 2, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }), // spread = 3.0
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 3, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const inconclusiveRuns = [
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({}, 'API Timeout'),
      ];

      const res = evaluateScoreSpread([
        { name: 'fixture-pass', role: 'SWE', runs: passingRuns, expected: standardExpected },
        { name: 'fixture-fail', role: 'SWE', runs: failingRuns, expected: standardExpected },
        { name: 'fixture-inconclusive', role: 'SWE', runs: inconclusiveRuns, expected: standardExpected },
      ]);

      expect(res.pass).toBe(false);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.passedFixtures[0].fixtureName).toBe('fixture-pass');
      expect(res.exceededFixtures).toEqual([
        { fixtureName: 'fixture-fail', category: 'Problem Solving & Algorithms', spread: 3.0 },
      ]);
      expect(res.inconclusiveFixtures).toEqual([
        { fixtureName: 'fixture-inconclusive', reason: 'Expected exactly 5 runs, but received 2' },
      ]);
    });

    it('fails as INCONCLUSIVE when expected rubric contains empty or whitespace category name', () => {
      const emptyCatExpected: FixtureExpected = {
        role: 'software-engineer',
        scores: [
          { category: '   ', min: 1, max: 5, reason: '' },
          { category: 'Software Design & Architecture', min: 1, max: 5, reason: '' },
        ],
      };
      const runs = Array.from({ length: 5 }, () =>
        makeSpreadRun({ '   ': 4, 'Software Design & Architecture': 4 })
      );

      const res = evaluateScoreSpread([
        { name: 'empty-cat', role: 'Software Engineer', runs, expected: emptyCatExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('contains empty category name');
    });

    it('fails as INCONCLUSIVE when expected rubric contains duplicated category names', () => {
      const duplicateExpected: FixtureExpected = {
        role: 'software-engineer',
        scores: [
          { category: 'Problem Solving & Algorithms', min: 1, max: 5, reason: '' },
          { category: 'Problem Solving & Algorithms', min: 1, max: 5, reason: '' },
        ],
      };
      const runs = Array.from({ length: 5 }, () =>
        makeSpreadRun({ 'Problem Solving & Algorithms': 4 })
      );

      const res = evaluateScoreSpread([
        { name: 'dup-cat', role: 'Software Engineer', runs, expected: duplicateExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain(
        'contains duplicated category: "Problem Solving & Algorithms"'
      );
    });

    it('classifies empty-answers as SKIPPED and does not cause a false benchmark failure when all evaluatable fixtures pass', () => {
      const passingRuns = Array.from({ length: 5 }, () =>
        makeSpreadRun({
          'Problem Solving & Algorithms': 4,
          'Software Design & Architecture': 4,
          'Technical Communication': 4,
        })
      );

      const emptyAnswersFixture = {
        name: 'empty-answers',
        role: 'n/a',
        runs: [] as RunResult[],
        expected: undefined,
        pass: true,
        failReasons: [],
        hasCandidateAnswers: false,
      };

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs: passingRuns, expected: standardExpected, hasCandidateAnswers: true },
        emptyAnswersFixture,
      ]);

      expect(res.pass).toBe(true);
      expect(res.fixtureResults).toHaveLength(2);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.passedFixtures[0].fixtureName).toBe('good');
      expect(res.skippedFixtures).toHaveLength(1);
      expect(res.skippedFixtures[0].fixtureName).toBe('empty-answers');
      expect(res.skippedFixtures[0].reason).toContain('no candidate answers; not applicable to score consistency');
      expect(res.inconclusiveFixtures).toHaveLength(0);
      expect(res.exceededFixtures).toHaveLength(0);
    });

    it('fails as INCONCLUSIVE and causes overall benchmark failure when an evaluatable fixture has zero runs', () => {
      const passingRuns = Array.from({ length: 5 }, () =>
        makeSpreadRun({
          'Problem Solving & Algorithms': 4,
          'Software Design & Architecture': 4,
          'Technical Communication': 4,
        })
      );

      const evaluatableZeroRuns = {
        name: 'evaluatable-zero-runs',
        role: 'Software Engineer',
        runs: [] as RunResult[],
        expected: standardExpected,
        hasCandidateAnswers: true,
      };

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs: passingRuns, expected: standardExpected, hasCandidateAnswers: true },
        evaluatableZeroRuns,
      ]);

      expect(res.pass).toBe(false);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures[0].fixtureName).toBe('evaluatable-zero-runs');
      expect(res.inconclusiveFixtures[0].reason).toContain('Expected exactly 5 runs, but received 0');
    });

    it('fails as INCONCLUSIVE and causes overall benchmark failure when an evaluatable fixture has incomplete runs', () => {
      const passingRuns = Array.from({ length: 5 }, () =>
        makeSpreadRun({
          'Problem Solving & Algorithms': 4,
          'Software Design & Architecture': 4,
          'Technical Communication': 4,
        })
      );

      const evaluatableIncomplete = {
        name: 'evaluatable-incomplete',
        role: 'Software Engineer',
        runs: [passingRuns[0], passingRuns[1], passingRuns[2]],
        expected: standardExpected,
        hasCandidateAnswers: true,
      };

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs: passingRuns, expected: standardExpected, hasCandidateAnswers: true },
        evaluatableIncomplete,
      ]);

      expect(res.pass).toBe(false);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures[0].fixtureName).toBe('evaluatable-incomplete');
      expect(res.inconclusiveFixtures[0].reason).toContain('Expected exactly 5 runs, but received 3');
    });

    it('fails as INCONCLUSIVE and causes overall benchmark failure when an evaluatable fixture is missing its expected rubric', () => {
      const passingRuns = Array.from({ length: 5 }, () =>
        makeSpreadRun({
          'Problem Solving & Algorithms': 4,
          'Software Design & Architecture': 4,
          'Technical Communication': 4,
        })
      );

      const evaluatableMissingExpected = {
        name: 'evaluatable-no-rubric',
        role: 'Software Engineer',
        runs: passingRuns,
        expected: undefined,
        hasCandidateAnswers: true,
      };

      const res = evaluateScoreSpread([
        { name: 'good', role: 'Software Engineer', runs: passingRuns, expected: standardExpected, hasCandidateAnswers: true },
        evaluatableMissingExpected,
      ]);

      expect(res.pass).toBe(false);
      expect(res.passedFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures).toHaveLength(1);
      expect(res.inconclusiveFixtures[0].fixtureName).toBe('evaluatable-no-rubric');
      expect(res.inconclusiveFixtures[0].reason).toContain('missing or has zero categories defined');
    });

    it('matches run categories with surrounding whitespace consistently without silently merging genuine duplicates', () => {
      // 5 runs where one run has leading/trailing whitespace around category names
      const runs = [
        makeSpreadRun({ '  Problem Solving & Algorithms  ': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 5, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'whitespace-match', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(true);
      expect(res.fixtureResults[0].status).toBe('PASS');
      expect(res.fixtureResults[0].maxSpread).toBe(1.0);

      // Verify that if a single run contains both trimmed and untrimmed versions, it is flagged as duplicate (not merged)
      const duplicateWhitespaceRun: RunResult = {
        wallMs: 1000,
        promptTokens: 500,
        outputTokens: 200,
        scores: [
          { category: 'Problem Solving & Algorithms', score: 4 },
          { category: '  Problem Solving & Algorithms  ', score: 5 },
          { category: 'Software Design & Architecture', score: 4 },
          { category: 'Technical Communication', score: 4 },
        ],
      };
      const dupRuns = [
        duplicateWhitespaceRun,
        runs[1],
        runs[2],
        runs[3],
        runs[4],
      ];
      const dupRes = evaluateScoreSpread([
        { name: 'whitespace-dup', role: 'Software Engineer', runs: dupRuns, expected: standardExpected },
      ]);
      expect(dupRes.pass).toBe(false);
      expect(dupRes.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(dupRes.fixtureResults[0].inconclusiveReason).toContain(
        'Run 1 has duplicated category: "Problem Solving & Algorithms"'
      );
    });

    it('fails as INCONCLUSIVE when a run has an empty or whitespace-only category name', () => {
      const runs = [
        makeSpreadRun({ '   ': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
        makeSpreadRun({ 'Problem Solving & Algorithms': 4, 'Software Design & Architecture': 4, 'Technical Communication': 4 }),
      ];

      const res = evaluateScoreSpread([
        { name: 'empty-run-cat', role: 'Software Engineer', runs, expected: standardExpected },
      ]);
      expect(res.pass).toBe(false);
      expect(res.fixtureResults[0].status).toBe('INCONCLUSIVE');
      expect(res.fixtureResults[0].inconclusiveReason).toContain('Run 1 has empty category name');
    });
  });

  describe('Benchmark Retry & Rate-Limit Handling (parseRetryAfterMs & runWithRetry)', () => {
    describe('parseRetryAfterMs', () => {
      it('parses server retryDelay in seconds and adds 2s safety buffer', () => {
        const errorJson = JSON.stringify({
          error: {
            code: 429,
            details: [{ retryDelay: '10s' }],
          },
        });
        const waitMs = parseRetryAfterMs(errorJson, 13000);
        // 10s * 1000 + 2000 = 12000 ms
        expect(waitMs).toBe(12000);
      });

      it('parses fractional seconds in retryDelay', () => {
        const errorJson = JSON.stringify({
          error: {
            details: [{ retryDelay: '2.5s' }],
          },
        });
        const waitMs = parseRetryAfterMs(errorJson, 13000);
        // 2.5s * 1000 + 2000 = 4500 ms
        expect(waitMs).toBe(4500);
      });

      it('falls back to defaultMs when error message has no retryDelay', () => {
        const errorJson = JSON.stringify({
          error: { code: 429, message: 'Resource exhausted' },
        });
        expect(parseRetryAfterMs(errorJson, 13000)).toBe(13000);
      });

      it('falls back to defaultMs on malformed JSON', () => {
        expect(parseRetryAfterMs('Not valid JSON', 13000)).toBe(13000);
      });
    });

    describe('runWithRetry', () => {
      it('succeeds on first attempt without retrying', async () => {
        let attempts = 0;
        const res = await runWithRetry(async () => {
          attempts++;
          return 'ok';
        });
        expect(res).toBe('ok');
        expect(attempts).toBe(1);
      });

      it('retries on HTTP 503 UNAVAILABLE and succeeds when next attempt succeeds', async () => {
        let attempts = 0;
        const sleepCalls: number[] = [];
        const res = await runWithRetry(
          async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
            }
            return 'recovered';
          },
          {
            maxRetries: 3,
            defaultBackoffMs: 1000,
            sleepFn: async (ms) => {
              sleepCalls.push(ms);
            },
            onRetry: () => {},
          }
        );
        expect(res).toBe('recovered');
        expect(attempts).toBe(3);
        expect(sleepCalls).toEqual([1000, 1000]);
      });

      it('throws HTTP 503 error accurately when all retries are exhausted', async () => {
        let attempts = 0;
        await expect(
          runWithRetry(
            async () => {
              attempts++;
              throw new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
            },
            {
              maxRetries: 2,
              defaultBackoffMs: 500,
              sleepFn: async () => {},
              onRetry: () => {},
            }
          )
        ).rejects.toThrow('high demand');
        expect(attempts).toBe(3); // 1 initial + 2 retries
      });

      it('retries on timeout / DEADLINE_EXCEEDED and throws timeout error if exhausted', async () => {
        let attempts = 0;
        await expect(
          runWithRetry(
            async () => {
              attempts++;
              throw new Error('DEADLINE_EXCEEDED: Evaluation timed out after 30000 ms');
            },
            {
              maxRetries: 2,
              defaultBackoffMs: 500,
              sleepFn: async () => {},
              onRetry: () => {},
            }
          )
        ).rejects.toThrow('DEADLINE_EXCEEDED');
        expect(attempts).toBe(3);
      });

      it('retries on HTTP 429 when retryDelay is within maxRetryWaitMs', async () => {
        let attempts = 0;
        const sleepCalls: number[] = [];
        const res = await runWithRetry(
          async () => {
            attempts++;
            if (attempts === 1) {
              throw new Error(
                JSON.stringify({
                  error: {
                    code: 429,
                    status: 'RESOURCE_EXHAUSTED',
                    details: [{ retryDelay: '5s' }],
                  },
                })
              );
            }
            return 'rate-limit-resolved';
          },
          {
            maxRetries: 2,
            maxRetryWaitMs: 60000,
            sleepFn: async (ms) => {
              sleepCalls.push(ms);
            },
            onRetry: () => {},
          }
        );
        expect(res).toBe('rate-limit-resolved');
        expect(attempts).toBe(2);
        expect(sleepCalls).toEqual([7000]); // 5s + 2s buffer
      });

      it('immediately throws ExcessiveRetryDelayError without sleeping when retryDelay exceeds maxRetryWaitMs', async () => {
        let attempts = 0;
        let sleepCalled = false;
        const hugeDelayJson = JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            details: [{ retryDelay: '82656s' }],
          },
        });

        await expect(
          runWithRetry(
            async () => {
              attempts++;
              throw new Error(hugeDelayJson);
            },
            {
              maxRetries: 3,
              maxRetryWaitMs: MAX_RETRY_WAIT_MS, // 60s
              sleepFn: async () => {
                sleepCalled = true;
              },
            }
          )
        ).rejects.toThrowError(ExcessiveRetryDelayError);

        expect(attempts).toBe(1);
        expect(sleepCalled).toBe(false); // Did not sleep for 23 hours!
      });
    });
  });

  describe('Benchmark Resume & Cache Handling', () => {
    const validExpected: FixtureExpected = {
      role: 'software-engineer',
      scores: [
        { category: 'Problem Solving & Algorithms', min: 2, max: 4, reason: 'test' },
        { category: 'Software Design & Architecture', min: 2, max: 4, reason: 'test' },
        { category: 'Technical Communication', min: 2, max: 4, reason: 'test' },
      ],
    };

    const makeRuns = (count: number, scoreVal = 4, errorMsg?: string): RunResult[] =>
      Array.from({ length: count }, (_, i) => ({
        wallMs: 15000,
        promptTokens: 1800,
        outputTokens: 1100,
        scores: errorMsg
          ? []
          : [
              { category: 'Problem Solving & Algorithms', score: scoreVal },
              { category: 'Software Design & Architecture', score: scoreVal },
              { category: 'Technical Communication', score: scoreVal },
            ],
        error: errorMsg,
      }));

    describe('isValidCachedFixture', () => {
      it('returns true when fixture has exactly requested runs, all successful, matching expected rubric', () => {
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs: makeRuns(5),
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(true);
      });

      it('returns false when fixture is undefined or has no runs', () => {
        expect(isValidCachedFixture(undefined, 5)).toBe(false);
        expect(isValidCachedFixture({ name: 'x', role: 'r', runs: [], expected: undefined, pass: true, failReasons: [] }, 5)).toBe(false);
      });

      it('returns false when run count is fewer than requested (e.g. 4/5)', () => {
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs: makeRuns(4),
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(false);
      });

      it('returns false when run count exceeds requested (e.g. 6/5)', () => {
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs: makeRuns(6),
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(false);
      });

      it('returns false when any run contains an error', () => {
        const runs = makeRuns(4);
        runs.push({ wallMs: 1000, promptTokens: 0, outputTokens: 0, scores: [], error: 'Rate limit error' });
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: false,
          failReasons: ['Rate limit error'],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(false);
      });

      it('returns false when any run has invalid or out-of-range scores', () => {
        const runs = makeRuns(5);
        runs[2].scores[0].score = 6; // Out of range
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(false);
      });

      it('returns false when an expected category is missing from any run', () => {
        const runs = makeRuns(5);
        runs[0].scores = [{ category: 'Problem Solving & Algorithms', score: 4 }]; // Missing 2 categories
        const fixture: FixtureResult = {
          name: 'average',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(fixture, 5, validExpected)).toBe(false);
      });
    });

    describe('isValidCachedRun & filterValidCachedRuns', () => {
      it('validates individual error-free run with valid scores', () => {
        const run = makeRuns(1)[0];
        expect(isValidCachedRun(run, validExpected)).toBe(true);
      });

      it('rejects run with error', () => {
        const erroredRun: RunResult = {
          wallMs: 1000,
          promptTokens: 0,
          outputTokens: 0,
          scores: [],
          error: 'Connection timeout',
        };
        expect(isValidCachedRun(erroredRun, validExpected)).toBe(false);
      });

      it('rejects run missing an expected category', () => {
        const incompleteRun: RunResult = {
          wallMs: 15000,
          promptTokens: 1800,
          outputTokens: 1100,
          scores: [{ category: 'Problem Solving & Algorithms', score: 4 }],
        };
        expect(isValidCachedRun(incompleteRun, validExpected)).toBe(false);
      });

      it('filters out errored runs and retains only valid runs', () => {
        const mixedRuns: RunResult[] = [
          makeRuns(1, 4)[0],
          { wallMs: 1000, promptTokens: 0, outputTokens: 0, scores: [], error: 'DNS error' },
          makeRuns(1, 5)[0],
        ];
        const filtered = filterValidCachedRuns(mixedRuns, validExpected);
        expect(filtered).toHaveLength(2);
        expect(filtered.every((r) => !r.error)).toBe(true);
      });
    });

    describe('Run-Level Top-Up Behavior', () => {
      it('simulates topping up 3 cached runs with 2 new runs to produce a complete 5-run fixture', () => {
        // Start with 3 cached runs
        const partialCachedRuns = makeRuns(3, 4);
        expect(isValidCachedFixture({ name: 'partial', role: 'r', runs: partialCachedRuns, expected: undefined, pass: false, failReasons: [] }, 5)).toBe(false);

        // Top up with 2 new runs
        const newRuns = makeRuns(2, 5);
        const combinedRuns = [...partialCachedRuns, ...newRuns];

        expect(combinedRuns).toHaveLength(5);
        const completeFixture: FixtureResult = {
          name: 'partial',
          role: 'Software Engineer',
          runs: combinedRuns,
          expected: validExpected,
          pass: true,
          failReasons: [],
        };
        expect(isValidCachedFixture(completeFixture, 5, validExpected)).toBe(true);
      });

      it('strictly requires all 5 runs to be successful before spread evaluation passes', () => {
        // 4 valid runs + 1 errored run
        const runs = makeRuns(4, 4);
        runs.push({ wallMs: 1000, promptTokens: 0, outputTokens: 0, scores: [], error: 'Timeout' });

        const fixture: FixtureResult = {
          name: 'backend-intermediate',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: false,
          failReasons: ['Timeout'],
        };
        const spreadEval = evaluateScoreSpread([fixture], { requestedRuns: 5, maxSpreadThreshold: 1.0 });
        expect(spreadEval.pass).toBe(false);
        expect(spreadEval.inconclusiveFixtures).toHaveLength(1);
        expect(spreadEval.inconclusiveFixtures[0].fixtureName).toBe('backend-intermediate');
      });
    });

    describe('computeFixtureFingerprint & Cache Invalidation', () => {
      const baseOptions = {
        model: 'gemini-3.8-flash',
        prompt: 'You are an interviewer evaluator for SWE...',
        turns: [{ speaker: 'CANDIDATE' as const, text: 'I used binary search.' }],
        expected: validExpected,
      };

      it('computes deterministic SHA-256 fingerprint for identical inputs', () => {
        const fp1 = computeFixtureFingerprint(baseOptions);
        const fp2 = computeFixtureFingerprint(baseOptions);
        expect(fp1).toHaveLength(64);
        expect(fp1).toBe(fp2);
      });

      it('produces a different fingerprint when the model changes', () => {
        const fpBase = computeFixtureFingerprint(baseOptions);
        const fpOtherModel = computeFixtureFingerprint({ ...baseOptions, model: 'gemini-3.5-flash' });
        expect(fpOtherModel).not.toBe(fpBase);
      });

      it('produces a different fingerprint when the prompt changes', () => {
        const fpBase = computeFixtureFingerprint(baseOptions);
        const fpNewPrompt = computeFixtureFingerprint({ ...baseOptions, prompt: 'Modified prompt text...' });
        expect(fpNewPrompt).not.toBe(fpBase);
      });

      it('produces a different fingerprint when fixture turns change', () => {
        const fpBase = computeFixtureFingerprint(baseOptions);
        const fpNewTurns = computeFixtureFingerprint({
          ...baseOptions,
          turns: [{ speaker: 'CANDIDATE' as const, text: 'I used linear search.' }],
        });
        expect(fpNewTurns).not.toBe(fpBase);
      });

      it('produces a different fingerprint when expected rubric changes', () => {
        const fpBase = computeFixtureFingerprint(baseOptions);
        const fpNewExpected = computeFixtureFingerprint({
          ...baseOptions,
          expected: {
            role: 'Backend Developer',
            scores: [{ category: 'API Design & Architecture', min: 4, max: 5, reason: 'test' }],
          },
        });
        expect(fpNewExpected).not.toBe(fpBase);
      });

      it('isValidCachedFixture returns true when fingerprint matches and false when fingerprint differs', () => {
        const fp = computeFixtureFingerprint(baseOptions);
        const runs = makeRuns(5).map((r) => ({ ...r, fingerprint: fp }));
        const fixture: FixtureResult = {
          name: 'test',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: true,
          failReasons: [],
          fingerprint: fp,
        };

        expect(isValidCachedFixture(fixture, 5, validExpected, fp)).toBe(true);
        expect(isValidCachedFixture(fixture, 5, validExpected, 'different-fingerprint-hex')).toBe(false);
      });

      it('filterValidCachedRuns excludes cached runs with mismatched fingerprints', () => {
        const fp = computeFixtureFingerprint(baseOptions);
        const runs = makeRuns(3).map((r) => ({ ...r, fingerprint: fp }));
        runs.push({ ...makeRuns(1)[0], fingerprint: 'stale-fingerprint' });

        const filtered = filterValidCachedRuns(runs, validExpected, fp);
        expect(filtered).toHaveLength(3);
      });

      it('rejects a cached run with no stored fingerprint when expectedFingerprint is provided', () => {
        const fp = computeFixtureFingerprint(baseOptions);
        // makeRuns() does not set fingerprint — fingerprint is undefined
        const runWithoutFingerprint = makeRuns(1)[0];
        expect(isValidCachedRun(runWithoutFingerprint, validExpected, fp)).toBe(false);
      });

      it('rejects a cached fixture with no stored fingerprint when expectedFingerprint is provided', () => {
        const fp = computeFixtureFingerprint(baseOptions);
        // runs have no fingerprint property (undefined)
        const runs = makeRuns(5);
        const fixture: FixtureResult = {
          name: 'test-no-fp',
          role: 'Software Engineer',
          runs,
          expected: validExpected,
          pass: true,
          failReasons: [],
          // fingerprint intentionally omitted — simulates old cached entry
        };
        expect(isValidCachedFixture(fixture, 5, validExpected, fp)).toBe(false);
      });

      it('filterValidCachedRuns excludes runs with missing fingerprints when expectedFingerprint is provided', () => {
        const fp = computeFixtureFingerprint(baseOptions);
        const runsWithFp = makeRuns(2).map((r) => ({ ...r, fingerprint: fp }));
        const runsWithoutFp = makeRuns(2); // fingerprint is undefined
        const mixed = [...runsWithFp, ...runsWithoutFp];
        const filtered = filterValidCachedRuns(mixed, validExpected, fp);
        // Only the 2 runs with the correct fingerprint should survive
        expect(filtered).toHaveLength(2);
      });
    });

    describe('loadBenchCache & saveBenchCache', () => {
      it('returns empty object if cache file does not exist', () => {
        expect(loadBenchCache('non-existent-cache-file.json')).toEqual({});
      });

      it('atomically saves and reloads cache', () => {
        const tempCachePath = path.resolve(__dirname, `../../.temp-cache-${Date.now()}.json`);
        const sampleCache: Record<string, FixtureResult> = {
          testFixture: {
            name: 'testFixture',
            role: 'Software Engineer',
            runs: makeRuns(5),
            expected: validExpected,
            pass: true,
            failReasons: [],
          },
        };

        try {
          saveBenchCache(tempCachePath, sampleCache);
          const loaded = loadBenchCache(tempCachePath);
          expect(loaded).toBeDefined();
          expect(loaded.testFixture).toBeDefined();
          expect(loaded.testFixture.runs).toHaveLength(5);
        } finally {
          if (existsSync(tempCachePath)) {
            unlinkSync(tempCachePath);
          }
        }
      });

      it('incremental persistence: survives interruption and recovers on next execution without re-calling the evaluator for cached runs', async () => {
        const fixtureName = 'interruption-test-fixture';
        const runsPerFixture = 5;
        const tempCachePath = path.resolve(__dirname, `../../.temp-incr-cache-${Date.now()}.json`);
        const fp = computeFixtureFingerprint({
          model: 'gemini-3.8-flash',
          prompt: 'You are an evaluator...',
          turns: [{ speaker: 'CANDIDATE' as const, text: 'I used binary search.' }],
          expected: validExpected,
        });

        // Mock evaluator: returns a valid RunResult and counts calls.
        let evaluatorCallCount = 0;
        const mockEvaluator = async (): Promise<RunResult> => {
          evaluatorCallCount++;
          return { ...makeRuns(1)[0], fingerprint: fp };
        };

        // Helper: mirrors the incremental-save block in bench.ts exactly.
        // After each successful run, writes [...runs] to cache[fixtureName] and flushes to disk.
        const persistIncremental = (
          cache: Record<string, FixtureResult>,
          runs: RunResult[]
        ) => {
          cache[fixtureName] = {
            name: fixtureName,
            role: 'Software Engineer',
            runs: [...runs],
            expected: validExpected,
            pass: undefined,
            failReasons: [],
            hasCandidateAnswers: true,
            fingerprint: fp,
          };
          saveBenchCache(tempCachePath, cache);
        };

        try {
          // ── Phase 1: benchmark starts, completes 2 of 5 runs, then is interrupted ──────────
          //
          // Mirrors bench.ts main loop:
          //   const runs: RunResult[] = [];
          //   for (let run = runs.length; run < runsPerFixture; run++) {
          //     const runResult = await evaluator(...);
          //     runs.push(runResult);
          //     cache[name] = { runs: [...runs], ... };   // ← incremental save
          //     saveBenchCache(cachePath, cache);
          //   }
          //   ⚡ process killed after run 2
          const phase1Cache: Record<string, FixtureResult> = {};
          const phase1Runs: RunResult[] = [];

          for (let i = 0; i < 2; i++) {
            const run = await mockEvaluator();
            phase1Runs.push(run);
            persistIncremental(phase1Cache, phase1Runs);  // saved after every run
          }
          // Interruption: exactly 2 evaluator calls made, 2 runs on disk.
          expect(evaluatorCallCount).toBe(2);

          // Verify disk state after interruption: 2 valid runs persisted.
          const diskAfterPhase1 = loadBenchCache(tempCachePath);
          expect(diskAfterPhase1[fixtureName]).toBeDefined();
          expect(filterValidCachedRuns(diskAfterPhase1[fixtureName].runs, validExpected, fp)).toHaveLength(2);
          // Fixture is partial — not yet complete.
          expect(isValidCachedFixture(diskAfterPhase1[fixtureName], runsPerFixture, validExpected, fp)).toBe(false);

          // ── Phase 2: new benchmark execution using the same cache file ────────────────────
          //
          // Mirrors bench.ts recovery path:
          //   const cache = loadBenchCache(cachePath);
          //   const existingValidRuns = filterValidCachedRuns(cache[name].runs, expected, fp);
          //   runs.push(...existingValidRuns);            // ← reuse cached runs
          //   for (let run = runs.length; run < runsPerFixture; run++) { ... }
          evaluatorCallCount = 0; // reset counter for phase 2

          const phase2Cache = loadBenchCache(tempCachePath);
          const recoveredRuns = filterValidCachedRuns(
            phase2Cache[fixtureName]?.runs,
            validExpected,
            fp
          );

          // Verify: 2 runs recovered, loop will start at index 2.
          expect(recoveredRuns).toHaveLength(2);
          expect(recoveredRuns[0]).toEqual(phase1Runs[0]);
          expect(recoveredRuns[1]).toEqual(phase1Runs[1]);

          const phase2Runs: RunResult[] = [...recoveredRuns]; // pre-populate, same as bench.ts

          for (let i = phase2Runs.length; i < runsPerFixture; i++) {
            const run = await mockEvaluator();
            phase2Runs.push(run);
            persistIncremental(phase2Cache, phase2Runs);
          }

          // Evaluator called exactly (runsPerFixture - recovered) = 3 times; never for cached runs.
          expect(evaluatorCallCount).toBe(runsPerFixture - 2);

          // ── Final disk state: all 5 runs present and valid ───────────────────────────────
          const finalCache = loadBenchCache(tempCachePath);
          const finalValidRuns = filterValidCachedRuns(finalCache[fixtureName]?.runs, validExpected, fp);
          expect(finalValidRuns).toHaveLength(runsPerFixture);

          // With all 5 valid runs on disk, the fixture is now recoverable as complete.
          expect(isValidCachedFixture(finalCache[fixtureName], runsPerFixture, validExpected, fp)).toBe(true);

          // ── Phase 3: subsequent execution with fully completed cache ─────────────────────
          // Evaluator should not be called at all when all runs are complete and cached.
          evaluatorCallCount = 0;
          const phase3Cache = loadBenchCache(tempCachePath);
          if (!isValidCachedFixture(phase3Cache[fixtureName], runsPerFixture, validExpected, fp)) {
            // Should not enter here
            for (let i = 0; i < runsPerFixture; i++) {
              await mockEvaluator();
            }
          }
          expect(evaluatorCallCount).toBe(0);
        } finally {
          if (existsSync(tempCachePath)) {
            unlinkSync(tempCachePath);
          }
        }
      });

      it('verifies seeded cache fixture validation and fails clearly if required fixture is missing in CI', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/seeded-cache.json');
        expect(
          existsSync(fixturePath),
          `Required benchmark cache test fixture missing in CI: ${fixturePath}`
        ).toBe(true);

        const cache = loadBenchCache(fixturePath);
        const fixtureKeys = Object.keys(cache);
        expect(fixtureKeys).toHaveLength(2);

        let completeCount = 0;
        let partialCount = 0;
        let totalValidRuns = 0;

        for (const key of fixtureKeys) {
          const fixture = cache[key];
          const validRuns = filterValidCachedRuns(fixture.runs, fixture.expected, fixture.fingerprint);
          totalValidRuns += validRuns.length;

          if (isValidCachedFixture(fixture, 5, fixture.expected, fixture.fingerprint)) {
            completeCount++;
            expect(fixture.runs).toHaveLength(5);
          } else {
            partialCount++;
            expect(fixture.runs.length).toBeLessThan(5);
          }
        }

        expect(completeCount).toBe(1);
        expect(partialCount).toBe(1);
        expect(totalValidRuns).toBe(8); // 5 complete + 3 partial
      });
    });
  });
});
