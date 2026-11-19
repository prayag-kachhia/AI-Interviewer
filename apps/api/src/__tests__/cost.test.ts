import { describe, it, expect } from 'vitest';
import {
  calculateTokenCost,
  calculateLiveAudioEstimate,
  calculateInterviewCost,
  aggregateFeedbackUsage,
  resolvePricingConfig,
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

    it('returns zero metrics when input list is empty or contains no records with valid usage', () => {
      const { count, averageUsage } = aggregateFeedbackUsage([
        { usage: null },
        { usage: undefined },
        { usage: 'not-an-object' },
      ]);
      expect(count).toBe(0);
      expect(averageUsage.promptTokens).toBe(0);
      expect(averageUsage.evaluator?.promptTokens).toBe(0);
      expect(averageUsage.nextQuestion?.callCount).toBe(0);
    });
  });

  describe('resolvePricingConfig', () => {
    it('uses defaults when environment variables are not set', () => {
      const config = resolvePricingConfig({});
      expect(config.model).toBe(DEFAULT_PRICING.model);
      expect(config.inputCostPer1M).toBe(DEFAULT_PRICING.inputCostPer1M);
      expect(config.outputCostPer1M).toBe(DEFAULT_PRICING.outputCostPer1M);
      expect(config.usdToInr).toBe(DEFAULT_PRICING.usdToInr);
    });

    it('respects environment overrides when provided', () => {
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
  });
});
