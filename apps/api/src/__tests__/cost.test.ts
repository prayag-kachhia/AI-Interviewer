import { describe, it, expect } from 'vitest';
import {
  calculateTokenCost,
  calculateLiveAudioEstimate,
  calculateInterviewCost,
  aggregateFeedbackUsage,
  resolvePricingConfig,
  isValidStoredUsage,
  parseArgs,
  DEFAULT_PRICING,
  DEFAULT_LIVE_AUDIO_CONFIG,
} from '../../scripts/cost';
import type { StoredFeedbackUsage } from '../services/feedback.service';

describe('Cost Script Calculation Functions (S-8 / NFR-16 / OI-2)', () => {
  describe('calculateTokenCost', () => {
    it('calculates USD and INR accurately for gemini-3.8-flash published rates', () => {
      // 1,000,000 prompt tokens = $0.75, 1,000,000 output tokens = $3.75
      const { costUSD, costINR } = calculateTokenCost(1_000_000, 1_000_000, DEFAULT_PRICING);
      expect(costUSD).toBeCloseTo(4.5, 5);
      expect(costINR).toBeCloseTo(4.5 * 84.0, 3);
    });

    it('calculates typical evaluation tokens correctly (1,450 prompt, 520 output)', () => {
      const { costUSD, costINR } = calculateTokenCost(1450, 520, DEFAULT_PRICING);
      const expectedUSD = (1450 / 1_000_000) * 0.75 + (520 / 1_000_000) * 3.75;
      expect(costUSD).toBeCloseTo(expectedUSD, 6);
      expect(costINR).toBeCloseTo(expectedUSD * 84.0, 4);
    });

    it('returns 0 cost for 0 tokens', () => {
      const { costUSD, costINR } = calculateTokenCost(0, 0, DEFAULT_PRICING);
      expect(costUSD).toBe(0);
      expect(costINR).toBe(0);
    });
  });

  describe('calculateLiveAudioEstimate', () => {
    it('models projected 15-minute Gemini Live audio costs from published rate cards', () => {
      const estimate = calculateLiveAudioEstimate(DEFAULT_LIVE_AUDIO_CONFIG, 84.0);

      // 10 min candidate @ 25 tok/sec = 15,000 tokens
      expect(estimate.candidateAudioTokens).toBe(15_000);
      // 15,000 / 1M * $3.00 = $0.045
      expect(estimate.candidateCostUSD).toBeCloseTo(0.045, 4);

      // 5 min interviewer @ 25 tok/sec = 7,500 tokens
      expect(estimate.interviewerAudioTokens).toBe(7_500);
      // 7,500 / 1M * $12.00 = $0.090
      expect(estimate.interviewerCostUSD).toBeCloseTo(0.09, 4);

      // Total USD = $0.045 + $0.090 = $0.135
      expect(estimate.totalCostUSD).toBeCloseTo(0.135, 4);
      expect(estimate.totalCostINR).toBeCloseTo(0.135 * 84.0, 2);
      expect(estimate.isProjectedEstimate).toBe(true);
    });
  });

  describe('calculateInterviewCost', () => {
    const sampleUsage: StoredFeedbackUsage = {
      promptTokens: 3250,
      outputTokens: 820,
      totalTokens: 4070,
      evaluator: { promptTokens: 1450, outputTokens: 520, totalTokens: 1970 },
      nextQuestion: { promptTokens: 1800, outputTokens: 300, totalTokens: 2100, callCount: 4 },
    };

    it('computes combined cost and verifies compliance against proposed ₹25 budget ceiling', () => {
      const summary = calculateInterviewCost(sampleUsage);

      // Evaluator: 1450 * 0.75/1M + 520 * 3.75/1M = $0.0010875 + $0.00195 = $0.0030375
      expect(summary.evaluator.costUSD).toBeCloseTo(0.0030375, 5);
      // NextQuestion: 1800 * 0.75/1M + 300 * 3.75/1M = $0.00135 + $0.001125 = $0.002475
      expect(summary.nextQuestion.costUSD).toBeCloseTo(0.002475, 5);

      // Combined text = $0.0055125 (~₹0.46)
      expect(summary.textTotal.costUSD).toBeCloseTo(0.0055125, 5);
      expect(summary.textTotal.costINR).toBeCloseTo(0.0055125 * 84.0, 3);

      // Projected Live Audio = ~$0.135 (~₹11.34)
      expect(summary.liveAudioEstimate.totalCostUSD).toBeCloseTo(0.135, 3);

      // Grand Total = ~$0.1405 (~₹11.80)
      expect(summary.grandTotalUSD).toBeCloseTo(0.0055125 + 0.135, 3);
      expect(summary.grandTotalINR).toBeLessThan(15.0);

      // Proposed ceiling is ₹25.0
      expect(summary.proposedCeilingINR).toBe(25.0);
      expect(summary.isWithinProposedCeiling).toBe(true);
    });

    it('gracefully handles null or missing usage, calculating only projected audio cost', () => {
      const summary = calculateInterviewCost(null);
      expect(summary.evaluator.promptTokens).toBe(0);
      expect(summary.textTotal.costUSD).toBe(0);
      expect(summary.grandTotalUSD).toBe(summary.liveAudioEstimate.totalCostUSD);
      expect(summary.isWithinProposedCeiling).toBe(true);
    });

    it('calculates interview cost with thinking tokens without double-counting', () => {
      const usageWithThoughts: StoredFeedbackUsage = {
        promptTokens: 3250,
        outputTokens: 900, // candidates (750) + thoughts (150)
        totalTokens: 4150, // 3250 + 900
        candidatesTokens: 750,
        thoughtsTokens: 150,
        evaluator: {
          promptTokens: 1450,
          outputTokens: 550, // 450 cand + 100 thought
          candidatesTokens: 450,
          thoughtsTokens: 100,
          totalTokens: 2000,
        },
        nextQuestion: {
          promptTokens: 1800,
          outputTokens: 350, // 300 cand + 50 thought
          candidatesTokens: 300,
          thoughtsTokens: 50,
          totalTokens: 2150,
          callCount: 4,
        },
      };

      const summary = calculateInterviewCost(usageWithThoughts);

      // Evaluator: 1450 in @ 0.75/1M ($0.0010875) + 550 out @ 3.75/1M ($0.0020625) = $0.00315
      expect(summary.evaluator.costUSD).toBeCloseTo(0.00315, 6);
      expect(summary.evaluator.costINR).toBeCloseTo(0.00315 * 84.0, 4);
      expect(summary.evaluator.thoughtsTokens).toBe(100);
      expect(summary.evaluator.candidatesTokens).toBe(450);

      // NextQuestion: 1800 in @ 0.75/1M ($0.00135) + 350 out @ 3.75/1M ($0.0013125) = $0.0026625
      expect(summary.nextQuestion.costUSD).toBeCloseTo(0.0026625, 6);
      expect(summary.nextQuestion.costINR).toBeCloseTo(0.0026625 * 84.0, 4);
      expect(summary.nextQuestion.thoughtsTokens).toBe(50);
      expect(summary.nextQuestion.candidatesTokens).toBe(300);

      // Text total: 3250 in ($0.0024375) + 900 out ($0.003375) = $0.0058125
      expect(summary.textTotal.costUSD).toBeCloseTo(0.0058125, 6);
      expect(summary.textTotal.costINR).toBeCloseTo(0.0058125 * 84.0, 4);
      expect(summary.textTotal.thoughtsTokens).toBe(150);
      expect(summary.textTotal.candidatesTokens).toBe(750);

      // Verify no double counting: outputCost is exactly based on outputTokens (candidates + thoughts)
      const expectedEvalOutputCost = (550 / 1_000_000) * 3.75;
      const expectedEvalPromptCost = (1450 / 1_000_000) * 0.75;
      expect(summary.evaluator.costUSD).toBeCloseTo(expectedEvalPromptCost + expectedEvalOutputCost, 6);
    });
  });

  describe('aggregateFeedbackUsage', () => {
    it('accurately computes arithmetic averages across multiple recorded feedback rows', () => {
      const row1 = {
        usage: {
          promptTokens: 3000,
          outputTokens: 800,
          totalTokens: 3800,
          evaluator: { promptTokens: 1400, outputTokens: 500, totalTokens: 1900 },
          nextQuestion: { promptTokens: 1600, outputTokens: 300, totalTokens: 1900, callCount: 3 },
        },
      };
      const row2 = {
        usage: {
          promptTokens: 4000,
          outputTokens: 1000,
          totalTokens: 5000,
          evaluator: { promptTokens: 1600, outputTokens: 600, totalTokens: 2200 },
          nextQuestion: { promptTokens: 2400, outputTokens: 400, totalTokens: 2800, callCount: 5 },
        },
      };

      const { count, averageUsage } = aggregateFeedbackUsage([row1, row2]);
      expect(count).toBe(2);
      expect(averageUsage.evaluator?.promptTokens).toBe(1500); // (1400 + 1600) / 2
      expect(averageUsage.evaluator?.outputTokens).toBe(550); // (500 + 600) / 2
      expect(averageUsage.nextQuestion?.promptTokens).toBe(2000); // (1600 + 2400) / 2
      expect(averageUsage.nextQuestion?.outputTokens).toBe(350); // (300 + 400) / 2
      expect(averageUsage.nextQuestion?.callCount).toBe(4); // (3 + 5) / 2
      expect(averageUsage.promptTokens).toBe(3500);
      expect(averageUsage.outputTokens).toBe(900);
      expect(averageUsage.totalTokens).toBe(4400);
    });

    it('returns zero metrics and tracks excluded count when input contains invalid or malformed usage', () => {
      const { count, averageUsage, excludedCount } = aggregateFeedbackUsage([
        { usage: null },
        { usage: undefined },
        { usage: 'not-an-object' },
        { usage: { promptTokens: 1000, outputTokens: 200 } }, // Incomplete (missing evaluator & nextQuestion)
      ]);
      expect(count).toBe(0);
      expect(excludedCount).toBe(4);
      expect(averageUsage.promptTokens).toBe(0);
      expect(averageUsage.evaluator?.promptTokens).toBe(0);
      expect(averageUsage.nextQuestion?.callCount).toBe(0);
    });

    it('excludes incomplete records rather than treating missing evaluator or nextQuestion data as zero', () => {
      const completeRecord = {
        usage: {
          promptTokens: 3000,
          outputTokens: 800,
          totalTokens: 3800,
          evaluator: { promptTokens: 1400, outputTokens: 500, totalTokens: 1900 },
          nextQuestion: { promptTokens: 1600, outputTokens: 300, totalTokens: 1900, callCount: 3 },
        },
      };

      // Incomplete: has top-level tokens but missing nextQuestion
      const missingNQ = {
        usage: {
          promptTokens: 1400,
          outputTokens: 500,
          totalTokens: 1900,
          evaluator: { promptTokens: 1400, outputTokens: 500, totalTokens: 1900 },
        },
      };

      // Incomplete: missing evaluator
      const missingEval = {
        usage: {
          promptTokens: 1600,
          outputTokens: 300,
          totalTokens: 1900,
          nextQuestion: { promptTokens: 1600, outputTokens: 300, totalTokens: 1900, callCount: 3 },
        },
      };

      const { count, averageUsage, excludedCount } = aggregateFeedbackUsage([
        completeRecord,
        missingNQ,
        missingEval,
      ]);

      // Only the 1 complete record must be counted in averages; the 2 incomplete records must be excluded
      expect(count).toBe(1);
      expect(excludedCount).toBe(2);
      expect(averageUsage.evaluator?.promptTokens).toBe(1400); // NOT (1400 + 1400 + 0) / 3
      expect(averageUsage.nextQuestion?.promptTokens).toBe(1600); // NOT (1600 + 0 + 1600) / 3
      expect(averageUsage.promptTokens).toBe(3000);
    });

    it('aggregates usage records containing thinking tokens accurately without double-counting', () => {
      const row1: { usage: StoredFeedbackUsage } = {
        usage: {
          promptTokens: 3000,
          outputTokens: 800, // 650 cand + 150 thought
          totalTokens: 3800,
          candidatesTokens: 650,
          thoughtsTokens: 150,
          evaluator: { promptTokens: 1400, outputTokens: 500, candidatesTokens: 400, thoughtsTokens: 100, totalTokens: 1900 },
          nextQuestion: { promptTokens: 1600, outputTokens: 300, candidatesTokens: 250, thoughtsTokens: 50, totalTokens: 1900, callCount: 3 },
        },
      };
      const row2: { usage: StoredFeedbackUsage } = {
        usage: {
          promptTokens: 4000,
          outputTokens: 1000, // 800 cand + 200 thought
          totalTokens: 5000,
          candidatesTokens: 800,
          thoughtsTokens: 200,
          evaluator: { promptTokens: 1600, outputTokens: 600, candidatesTokens: 500, thoughtsTokens: 100, totalTokens: 2200 },
          nextQuestion: { promptTokens: 2400, outputTokens: 400, candidatesTokens: 300, thoughtsTokens: 100, totalTokens: 2800, callCount: 5 },
        },
      };

      const { count, averageUsage } = aggregateFeedbackUsage([row1, row2]);
      expect(count).toBe(2);
      expect(averageUsage.promptTokens).toBe(3500);
      expect(averageUsage.outputTokens).toBe(900); // (800 + 1000) / 2
      expect(averageUsage.totalTokens).toBe(4400); // 3500 + 900
      expect(averageUsage.candidatesTokens).toBe(725); // (650 + 800) / 2
      expect(averageUsage.thoughtsTokens).toBe(175); // (150 + 200) / 2

      // Evaluator averages
      expect(averageUsage.evaluator?.promptTokens).toBe(1500);
      expect(averageUsage.evaluator?.outputTokens).toBe(550);
      expect(averageUsage.evaluator?.candidatesTokens).toBe(450);
      expect(averageUsage.evaluator?.thoughtsTokens).toBe(100);

      // NextQuestion averages
      expect(averageUsage.nextQuestion?.promptTokens).toBe(2000);
      expect(averageUsage.nextQuestion?.outputTokens).toBe(350);
      expect(averageUsage.nextQuestion?.candidatesTokens).toBe(275);
      expect(averageUsage.nextQuestion?.thoughtsTokens).toBe(75);

      // Verify mathematical identity: outputTokens = candidatesTokens + thoughtsTokens
      expect(averageUsage.outputTokens).toBe(averageUsage.candidatesTokens! + averageUsage.thoughtsTokens!);
    });

    it('aggregates mixed records (with and without thinking tokens) correctly', () => {
      const recordWithThoughts = {
        usage: {
          promptTokens: 3000,
          outputTokens: 800,
          totalTokens: 3800,
          candidatesTokens: 600,
          thoughtsTokens: 200,
          evaluator: { promptTokens: 1400, outputTokens: 500, candidatesTokens: 350, thoughtsTokens: 150, totalTokens: 1900 },
          nextQuestion: { promptTokens: 1600, outputTokens: 300, candidatesTokens: 250, thoughtsTokens: 50, totalTokens: 1900, callCount: 3 },
        },
      };
      const legacyRecordWithoutThoughts = {
        usage: {
          promptTokens: 3000,
          outputTokens: 600,
          totalTokens: 3600,
          evaluator: { promptTokens: 1400, outputTokens: 400, totalTokens: 1800 },
          nextQuestion: { promptTokens: 1600, outputTokens: 200, totalTokens: 1800, callCount: 3 },
        },
      };

      const { count, averageUsage } = aggregateFeedbackUsage([recordWithThoughts, legacyRecordWithoutThoughts]);
      expect(count).toBe(2);
      expect(averageUsage.outputTokens).toBe(700); // (800 + 600) / 2
      expect(averageUsage.thoughtsTokens).toBe(100); // (200 + 0) / 2
      expect(averageUsage.candidatesTokens).toBe(600); // (600 + 600) / 2
      expect(averageUsage.evaluator?.thoughtsTokens).toBe(75); // (150 + 0) / 2
      expect(averageUsage.nextQuestion?.thoughtsTokens).toBe(25); // (50 + 0) / 2
    });
  });

  describe('isValidStoredUsage (S-8 review: usage validation)', () => {
    const validUsage: StoredFeedbackUsage = {
      promptTokens: 3000,
      outputTokens: 800,
      totalTokens: 3800,
      evaluator: { promptTokens: 1400, outputTokens: 500, totalTokens: 1900 },
      nextQuestion: { promptTokens: 1600, outputTokens: 300, totalTokens: 1900, callCount: 3 },
    };

    it('accepts a fully-formed valid usage object', () => {
      expect(isValidStoredUsage(validUsage)).toBe(true);
    });

    it('accepts valid usage object containing optional thoughtsTokens and candidatesTokens', () => {
      const usageWithThoughts = {
        ...validUsage,
        candidatesTokens: 650,
        thoughtsTokens: 150,
        evaluator: { ...validUsage.evaluator!, candidatesTokens: 400, thoughtsTokens: 100 },
        nextQuestion: { ...validUsage.nextQuestion!, candidatesTokens: 250, thoughtsTokens: 50 },
      };
      expect(isValidStoredUsage(usageWithThoughts)).toBe(true);
    });

    it('rejects usage with invalid or negative thoughtsTokens or candidatesTokens', () => {
      expect(isValidStoredUsage({ ...validUsage, thoughtsTokens: -1 })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, thoughtsTokens: 'abc' as any })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, candidatesTokens: -5 })).toBe(false);
      expect(isValidStoredUsage({
        ...validUsage,
        evaluator: { ...validUsage.evaluator!, thoughtsTokens: -10 },
      })).toBe(false);
      expect(isValidStoredUsage({
        ...validUsage,
        nextQuestion: { ...validUsage.nextQuestion!, thoughtsTokens: NaN },
      })).toBe(false);
    });

    it('rejects primitives, arrays, null, and undefined', () => {
      expect(isValidStoredUsage(null)).toBe(false);
      expect(isValidStoredUsage(undefined)).toBe(false);
      expect(isValidStoredUsage('string')).toBe(false);
      expect(isValidStoredUsage(123)).toBe(false);
      expect(isValidStoredUsage([])).toBe(false);
    });

    it('rejects usage with missing top-level tokens or negative numbers', () => {
      expect(isValidStoredUsage({ ...validUsage, promptTokens: -1 })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, promptTokens: 'not-a-num' })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, promptTokens: NaN })).toBe(false);
    });

    it('rejects usage with missing or malformed nested evaluator structure', () => {
      const { evaluator, ...withoutEval } = validUsage;
      expect(isValidStoredUsage(withoutEval)).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, evaluator: null })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, evaluator: { promptTokens: 100 } })).toBe(false); // missing outputTokens
      expect(isValidStoredUsage({ ...validUsage, evaluator: { ...evaluator, promptTokens: -50 } })).toBe(false);
    });

    it('rejects usage with missing or malformed nested nextQuestion structure', () => {
      const { nextQuestion, ...withoutNQ } = validUsage;
      expect(isValidStoredUsage(withoutNQ)).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, nextQuestion: null })).toBe(false);
      expect(isValidStoredUsage({ ...validUsage, nextQuestion: { promptTokens: 100, outputTokens: 50 } })).toBe(false); // missing callCount
      expect(isValidStoredUsage({ ...validUsage, nextQuestion: { ...nextQuestion, callCount: -1 } })).toBe(false);
    });
  });

  describe('resolvePricingConfig (S-8 review: model rate validation)', () => {
    it('uses defaults when environment variables are not set', () => {
      const config = resolvePricingConfig({});
      expect(config.model).toBe(DEFAULT_PRICING.model);
      expect(config.inputCostPer1M).toBe(DEFAULT_PRICING.inputCostPer1M);
      expect(config.outputCostPer1M).toBe(DEFAULT_PRICING.outputCostPer1M);
      expect(config.usdToInr).toBe(DEFAULT_PRICING.usdToInr);
    });

    it('respects environment overrides when custom rates are fully provided', () => {
      const config = resolvePricingConfig({
        GEMINI_EVAL_MODEL: 'custom-model',
        BENCH_INPUT_COST_USD_PER_1M: '1.25',
        BENCH_OUTPUT_COST_USD_PER_1M: '5.50',
        BENCH_USD_TO_INR: '85.5',
      });
      expect(config.model).toBe('custom-model');
      expect(config.inputCostPer1M).toBe(1.25);
      expect(config.outputCostPer1M).toBe(5.50);
      expect(config.usdToInr).toBe(85.5);
    });

    it('throws error when custom unsupported model is specified without custom pricing rates', () => {
      expect(() => {
        resolvePricingConfig({
          GEMINI_EVAL_MODEL: 'unsupported-gemini-pro',
        });
      }).toThrow(/Unsupported pricing model "unsupported-gemini-pro"/);
    });

    it('throws error when custom unsupported model has only partial custom rates', () => {
      expect(() => {
        resolvePricingConfig({
          GEMINI_EVAL_MODEL: 'unsupported-gemini-pro',
          BENCH_INPUT_COST_USD_PER_1M: '1.25',
          // missing output rate
        });
      }).toThrow(/Unsupported pricing model "unsupported-gemini-pro"/);

      expect(() => {
        resolvePricingConfig({
          GEMINI_EVAL_MODEL: 'unsupported-gemini-pro',
          BENCH_OUTPUT_COST_USD_PER_1M: '5.00',
          // missing input rate
        });
      }).toThrow(/Unsupported pricing model "unsupported-gemini-pro"/);
    });

    it('rejects invalid or non-numeric custom pricing rates without silent fallback', () => {
      // Non-numeric strings
      expect(() => {
        resolvePricingConfig({
          BENCH_INPUT_COST_USD_PER_1M: 'invalid-rate',
        });
      }).toThrow(/Invalid pricing configuration for BENCH_INPUT_COST_USD_PER_1M/);

      expect(() => {
        resolvePricingConfig({
          BENCH_OUTPUT_COST_USD_PER_1M: 'abc',
        });
      }).toThrow(/Invalid pricing configuration for BENCH_OUTPUT_COST_USD_PER_1M/);

      // Negative values
      expect(() => {
        resolvePricingConfig({
          BENCH_INPUT_COST_USD_PER_1M: '-1.5',
        });
      }).toThrow(/Invalid pricing configuration for BENCH_INPUT_COST_USD_PER_1M/);

      expect(() => {
        resolvePricingConfig({
          BENCH_OUTPUT_COST_USD_PER_1M: '-0.1',
        });
      }).toThrow(/Invalid pricing configuration for BENCH_OUTPUT_COST_USD_PER_1M/);

      // Invalid exchange rates (must be positive finite numbers)
      expect(() => {
        resolvePricingConfig({
          BENCH_USD_TO_INR: '0',
        });
      }).toThrow(/Invalid exchange rate configuration for BENCH_USD_TO_INR/);

      expect(() => {
        resolvePricingConfig({
          BENCH_USD_TO_INR: '-84.0',
        });
      }).toThrow(/Invalid exchange rate configuration for BENCH_USD_TO_INR/);

      expect(() => {
        resolvePricingConfig({
          BENCH_USD_TO_INR: 'not-a-number',
        });
      }).toThrow(/Invalid exchange rate configuration for BENCH_USD_TO_INR/);
    });
  });

  describe('parseArgs (S-8 review: CLI arguments and --limit)', () => {
    it('parses --limit 50 correctly', () => {
      const parsed = parseArgs(['--limit', '50']);
      expect(parsed.limit).toBe(50);
    });

    it('parses --limit=25 syntax correctly', () => {
      const parsed = parseArgs(['--limit=25']);
      expect(parsed.limit).toBe(25);
    });

    it('parses --simulate flag correctly', () => {
      const parsed = parseArgs(['--simulate']);
      expect(parsed.simulate).toBe(true);
    });

    it('throws error on invalid or non-positive --limit values', () => {
      expect(() => parseArgs(['--limit', '0'])).toThrow(/Invalid --limit value/);
      expect(() => parseArgs(['--limit', 'abc'])).toThrow(/Invalid --limit value/);
      expect(() => parseArgs(['--limit=-5'])).toThrow(/Invalid --limit value/);
    });
  });
});
