import { describe, it, expect } from 'vitest';
import { Feedback, PerAnswerFeedback } from '@interview/contracts';

describe('Contracts — PN-9 PerAnswerFeedback (#174)', () => {
  it('parses valid perAnswer data with question, summary, strengths, and improvements', () => {
    const validItem = {
      question: 'How do you design a database schema for an e-commerce platform?',
      summary: 'Explained relational normalization up to 3NF and index placement on foreign keys.',
      strengths: ['Clear normalization rationale', 'Strategic indexing on foreign keys'],
      improvements: ['Consider partition strategies for orders table'],
    };

    const parsed = PerAnswerFeedback.parse(validItem);
    expect(parsed.question).toBe(validItem.question);
    expect(parsed.summary).toBe(validItem.summary);
    expect(parsed.strengths).toEqual(validItem.strengths);
    expect(parsed.improvements).toEqual(validItem.improvements);
  });

  it('rejects perAnswer item with empty question', () => {
    const invalid = {
      question: '',
      summary: 'Good explanation.',
      strengths: ['Clear'],
      improvements: ['None'],
    };
    expect(() => PerAnswerFeedback.parse(invalid)).toThrow();
  });

  it('rejects perAnswer item with empty summary', () => {
    const invalid = {
      question: 'Explain recursion.',
      summary: '',
      strengths: ['Clear'],
      improvements: ['None'],
    };
    expect(() => PerAnswerFeedback.parse(invalid)).toThrow();
  });

  it('rejects perAnswer item with non-array strengths or improvements', () => {
    expect(() =>
      PerAnswerFeedback.parse({
        question: 'Explain binary search.',
        summary: 'Logarithmic divide and conquer.',
        strengths: 'Fast',
        improvements: [],
      })
    ).toThrow();

    expect(() =>
      PerAnswerFeedback.parse({
        question: 'Explain binary search.',
        summary: 'Logarithmic divide and conquer.',
        strengths: [],
        improvements: null,
      })
    ).toThrow();
  });

  it('Feedback contract supports optional perAnswer field', () => {
    const feedbackWithPerAnswer = {
      sessionId: 'sess-123',
      status: 'ready' as const,
      summary: 'Great performance.',
      scores: [
        {
          category: 'Problem Solving & Algorithms',
          score: 5,
          comment: 'Precise.',
          strengths: ['Optimal complexity'],
          improvements: ['Edge case handling'],
          quote: 'I use binary search',
        },
      ],
      perAnswer: [
        {
          question: 'What is binary search?',
          summary: 'Logarithmic search on sorted arrays.',
          strengths: ['Accurate O(log N) analysis'],
          improvements: ['Mention overflow on mid calculation'],
        },
      ],
    };

    const parsed = Feedback.parse(feedbackWithPerAnswer);
    expect(parsed.perAnswer).toHaveLength(1);
    expect(parsed.perAnswer?.[0].question).toBe('What is binary search?');
  });

  it('Feedback contract maintains backward compatibility when perAnswer is missing', () => {
    const legacyFeedback = {
      sessionId: 'sess-legacy',
      status: 'ready' as const,
      summary: 'Legacy interview without perAnswer notes.',
      scores: [
        {
          category: 'Software Design & Architecture',
          score: 4,
          comment: 'Solid understanding.',
          strengths: ['Clean separation of concerns'],
          improvements: ['Elaborate on service boundaries'],
          quote: 'I split into controllers and services',
        },
      ],
    };

    const parsed = Feedback.parse(legacyFeedback);
    expect(parsed.perAnswer).toBeUndefined();
    expect(parsed.summary).toBe(legacyFeedback.summary);
    expect(parsed.scores).toHaveLength(1);
  });
});
