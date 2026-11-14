import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../db';
import {
  INSIGHT_TOPICS,
  buildInsightsPrompt,
  topicInsightsSchema,
  refreshInsightsForUser,
  handleInsightsRefresh,
  getImprovementPlan,
  generateImprovementPlan,
  validateResourceId,
  validatePlanAction,
  validateTopicPlan,
  validateImprovementPlanRoadmap,
  flattenPlan,
  InvalidResourceIdError,
  WEAKNESS_THRESHOLD,
} from '../services/insights.service';
import { isValidResourceId, LEARNING_RESOURCES } from '../data/resources';
import { handleJob } from '../worker';
import * as feedbackService from '../services/feedback.service';

vi.mock('../db', () => ({
  default: {
    session: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    improvementPlan: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../services/feedback.service', () => ({
  handleSessionEnded: vi.fn(),
}));

const USER_ID = 'user-123';
const SESSION_ID = 'sess-456';

const MOCK_SESSIONS = [
  {
    id: SESSION_ID,
    userId: USER_ID,
    role: 'backend-developer',
    status: 'ENDED' as const,
    startedAt: new Date('2026-11-01T10:00:00Z'),
    endedAt: new Date('2026-11-01T10:30:00Z'),
    createdAt: new Date('2026-11-01T10:00:00Z'),
    feedback: {
      id: 'fb-1',
      sessionId: SESSION_ID,
      status: 'ready',
      summary: 'Candidate demonstrated good knowledge of caching, but struggled with transaction isolation levels.',
      scores: [
        {
          category: 'Technical depth',
          score: 3,
          comment: 'Understood Redis caching but was confused on MVCC and phantom reads.',
          strengths: ['Clear caching strategies'],
          improvements: ['Review ACID transaction isolation levels'],
          quote: 'I would use Redis in front of the database.',
        },
      ],
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    turns: [
      {
        id: 'turn-1',
        sessionId: SESSION_ID,
        turnIndex: 1,
        speaker: 'AI' as const,
        text: 'How do you handle high read traffic and isolation in Postgres?',
        timestampSec: 2,
        createdAt: new Date(),
      },
      {
        id: 'turn-2',
        sessionId: SESSION_ID,
        turnIndex: 2,
        speaker: 'CANDIDATE' as const,
        text: 'I would use Redis in front of the database, but I am not completely sure about repeatable reads versus serializable.',
        timestampSec: 15,
        createdAt: new Date(),
      },
    ],
  },
];

const MOCK_GEMINI_OUTPUT = {
  topics: [
    {
      topic: 'DBMS',
      score: 2,
      summary: 'Struggled with transaction isolation levels and MVCC mechanisms.',
    },
    {
      topic: 'System Design',
      score: 4,
      summary: 'Clearly articulated Redis caching layers for high read traffic.',
    },
    {
      topic: 'SQL',
      score: 3,
      summary: 'General database knowledge present, but query-level details were minimal.',
    },
    {
      topic: 'OOP',
      score: 3,
      summary: 'Basic design demonstrated.',
    },
    {
      topic: 'OS',
      score: 3,
      summary: 'Moderate systems understanding.',
    },
    {
      topic: 'CN',
      score: 4,
      summary: 'Solid network concepts.',
    },
    {
      topic: 'DSA',
      score: 3,
      summary: 'Standard algorithms knowledge.',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('V-2 · Topic weaknesses from your interviews (Issue #181)', () => {
  describe('INSIGHT_TOPICS and prompt builder', () => {
    it('defines all 7 required core topics', () => {
      expect(INSIGHT_TOPICS).toEqual([
        'DBMS',
        'OOP',
        'OS',
        'CN',
        'DSA',
        'SQL',
        'System Design',
      ]);
    });

    it('builds an evaluation prompt including feedback summaries, category scores, and transcripts', () => {
      const prompt = buildInsightsPrompt(MOCK_SESSIONS);

      expect(prompt).toContain('Candidate Interview History and Feedback:');
      expect(prompt).toContain('backend-developer');
      expect(prompt).toContain('Feedback Summary: Candidate demonstrated good knowledge');
      expect(prompt).toContain('Technical depth: Score 3/5');
      expect(prompt).toContain('Strengths: Clear caching strategies');
      expect(prompt).toContain('Improvements: Review ACID transaction isolation levels');
      expect(prompt).toContain('Quote: "I would use Redis in front of the database."');
      expect(prompt).toContain('Candidate Transcript Answers:');
      expect(prompt).toContain('repeatable reads versus serializable');
      for (const topic of INSIGHT_TOPICS) {
        expect(prompt).toContain(topic);
      }
    });

    it('provides a structured schema with topic enum and integer score', () => {
      const schema = topicInsightsSchema();
      expect(schema.type).toBe('OBJECT');
      expect((schema.properties as any).topics.type).toBe('ARRAY');
      const itemProps = (schema.properties as any).topics.items.properties;
      expect(itemProps.topic.enum).toEqual([...INSIGHT_TOPICS]);
      expect(itemProps.score.type).toBe('INTEGER');
    });
  });

  describe('refreshInsightsForUser', () => {
    it('fetches recent sessions, calls Gemini, validates with Zod, and upserts ImprovementPlan', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);

      const mockPlan = {
        id: 'plan-1',
        userId: USER_ID,
        topics: MOCK_GEMINI_OUTPUT.topics,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce(mockPlan);

      const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(MOCK_GEMINI_OUTPUT));

      const result = await refreshInsightsForUser(USER_ID, {
        generate: mockGenerate,
      });

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: {
          userId: USER_ID,
          status: 'ENDED',
        },
        include: {
          feedback: true,
          turns: { orderBy: { turnIndex: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      expect(mockGenerate).toHaveBeenCalled();
      expect(prisma.improvementPlan.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        create: {
          userId: USER_ID,
          topics: MOCK_GEMINI_OUTPUT.topics,
          plan: expect.any(Array),
        },
        update: {
          topics: MOCK_GEMINI_OUTPUT.topics,
          plan: expect.any(Array),
        },
      });

      expect(result).toEqual(mockPlan);
    });

    it('handles markdown code fences in Gemini output', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce({
        id: 'plan-1',
        userId: USER_ID,
        topics: MOCK_GEMINI_OUTPUT.topics,
      });

      const fenced = '```json\n' + JSON.stringify(MOCK_GEMINI_OUTPUT) + '\n```';
      const mockGenerate = vi.fn().mockResolvedValueOnce(fenced);

      await refreshInsightsForUser(USER_ID, { generate: mockGenerate });

      expect(prisma.improvementPlan.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ topics: MOCK_GEMINI_OUTPUT.topics }),
        })
      );
    });

    it('rejects invalid JSON from the model', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);

      const mockGenerate = vi.fn().mockResolvedValueOnce('Invalid JSON string');

      await expect(
        refreshInsightsForUser(USER_ID, { generate: mockGenerate })
      ).rejects.toThrow('The insights generator did not return valid JSON');
    });

    it('rejects output with unrecognised topic names via Zod validation', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);

      const invalidOutput = {
        topics: [
          {
            topic: 'UnknownTopicName',
            score: 3,
            summary: 'Invalid topic',
          },
        ],
      };
      const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(invalidOutput));

      await expect(
        refreshInsightsForUser(USER_ID, { generate: mockGenerate })
      ).rejects.toThrow();
    });

    it('rejects scores outside 1-5 via Zod validation', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);

      const invalidOutput = {
        topics: [
          {
            topic: 'DBMS',
            score: 10,
            summary: 'Out of range',
          },
        ],
      };
      const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(invalidOutput));

      await expect(
        refreshInsightsForUser(USER_ID, { generate: mockGenerate })
      ).rejects.toThrow();
    });

    it('stores empty topics when the user has no ended sessions or candidate answers', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce([]);
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce({
        id: 'plan-empty',
        userId: USER_ID,
        topics: [],
      });

      const mockGenerate = vi.fn();
      await refreshInsightsForUser(USER_ID, { generate: mockGenerate });

      expect(mockGenerate).not.toHaveBeenCalled();
      expect(prisma.improvementPlan.upsert).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        create: { userId: USER_ID, topics: [], plan: [] },
        update: { topics: [], plan: [] },
      });
    });
  });

  describe('handleInsightsRefresh job handler', () => {
    it('refreshes insights when userId is in payload', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce({
        id: 'plan-1',
        userId: USER_ID,
        topics: MOCK_GEMINI_OUTPUT.topics,
      });

      const job: any = {
        id: 'job-insights-1',
        type: 'insights.refresh',
        sessionId: SESSION_ID,
        payload: { userId: USER_ID },
      };

      const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(MOCK_GEMINI_OUTPUT));

      await handleInsightsRefresh(job, { generate: mockGenerate });

      expect(prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) })
      );
    });

    it('resolves userId from session when payload has no userId', async () => {
      (prisma.session.findUnique as any).mockResolvedValueOnce({ userId: USER_ID });
      (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce({
        id: 'plan-1',
        userId: USER_ID,
        topics: MOCK_GEMINI_OUTPUT.topics,
      });

      const job: any = {
        id: 'job-insights-2',
        type: 'insights.refresh',
        sessionId: SESSION_ID,
        payload: {},
      };

      const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(MOCK_GEMINI_OUTPUT));

      await handleInsightsRefresh(job, { generate: mockGenerate });

      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { id: SESSION_ID },
        select: { userId: true },
      });
      expect(prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID }) })
      );
    });

    it('throws when job has neither userId nor sessionId', async () => {
      const job: any = {
        id: 'job-orphan',
        type: 'insights.refresh',
        sessionId: null,
        payload: {},
      };

      await expect(handleInsightsRefresh(job)).rejects.toThrow('has no userId and cannot resolve session');
    });
  });

  describe('worker dispatch (handleJob)', () => {
    it('dispatches session.ended to handleSessionEnded', async () => {
      const job: any = {
        id: 'job-1',
        type: 'session.ended',
        sessionId: SESSION_ID,
      };

      await handleJob(job);
      expect(feedbackService.handleSessionEnded).toHaveBeenCalledWith(job);
    });

    it('dispatches insights.refresh to handleInsightsRefresh', async () => {
      (prisma.session.findMany as any).mockResolvedValueOnce([]);
      (prisma.improvementPlan.upsert as any).mockResolvedValueOnce({
        id: 'plan-1',
        userId: USER_ID,
        topics: [],
      });

      const job: any = {
        id: 'job-2',
        type: 'insights.refresh',
        sessionId: SESSION_ID,
        payload: { userId: USER_ID },
      };

      await handleJob(job);
      expect(prisma.session.findMany).toHaveBeenCalled();
    });

    it('throws on unknown job type', async () => {
      const job: any = {
        id: 'job-unknown',
        type: 'unknown.job.type',
      };

      await expect(handleJob(job)).rejects.toThrow('Unknown job type: unknown.job.type');
    });
  });

  describe('getImprovementPlan', () => {
    it('retrieves improvement plan for a user', async () => {
      const mockPlan = {
        id: 'plan-1',
        userId: USER_ID,
        topics: MOCK_GEMINI_OUTPUT.topics,
      };
      (prisma.improvementPlan.findUnique as any).mockResolvedValueOnce(mockPlan);

      const result = await getImprovementPlan(USER_ID);
      expect(prisma.improvementPlan.findUnique).toHaveBeenCalledWith({
        where: { userId: USER_ID },
      });
      expect(result).toEqual(mockPlan);
    });
  });

  describe('V-4 · Improvement roadmap (Issue #183)', () => {
    const SAMPLE_TOPICS = [
      { topic: 'System Design' as const, score: 5, summary: 'Mastered distributed architectures.' },
      { topic: 'DBMS' as const, score: 2, summary: 'Struggled with transaction isolation levels.' },
      { topic: 'OS' as const, score: 1, summary: 'Major conceptual gaps in virtual memory.' },
      { topic: 'SQL' as const, score: 3, summary: 'Understands basic queries but weak on joins.' },
      { topic: 'OOP' as const, score: 4, summary: 'Good grasp of SOLID principles.' },
    ];

    describe('Plan generation and weakness ordering', () => {
      it('generates an ordered plan sorted strictly by weakness (lowest score first)', () => {
        const plan = generateImprovementPlan(SAMPLE_TOPICS);

        // Weak topics: OS (1), DBMS (2), SQL (3). Strong topics (OOP: 4, System Design: 5) are excluded.
        expect(plan.map((p) => p.topic)).toEqual(['OS', 'DBMS', 'SQL']);
        expect(plan[0].score).toBe(1);
        expect(plan[1].score).toBe(2);
        expect(plan[2].score).toBe(3);

        // Verification of weakness order: scores must be monotonically non-decreasing
        for (let i = 0; i < plan.length - 1; i++) {
          expect(plan[i].score).toBeLessThanOrEqual(plan[i + 1].score);
        }
      });

      it('excludes strong topics (score >= 4) from the weakness roadmap', () => {
        const plan = generateImprovementPlan(SAMPLE_TOPICS);

        const includedTopics = plan.map((p) => p.topic);
        expect(includedTopics).not.toContain('OOP');
        expect(includedTopics).not.toContain('System Design');
      });

      it('returns an empty plan when all evaluated topics are strong', () => {
        const strongTopics = [
          { topic: 'OOP' as const, score: 4, summary: 'Solid design' },
          { topic: 'CN' as const, score: 5, summary: 'Networking expert' },
        ];

        const plan = generateImprovementPlan(strongTopics);
        expect(plan).toEqual([]);
      });

      it('breaks score ties deterministically by topic name', () => {
        const tiedTopics = [
          { topic: 'SQL' as const, score: 2 },
          { topic: 'DBMS' as const, score: 2 },
          { topic: 'CN' as const, score: 2 },
        ];

        const plan = generateImprovementPlan(tiedTopics);
        expect(plan.map((p) => p.topic)).toEqual(['CN', 'DBMS', 'SQL']);
      });

      it('respects a custom weaknessThreshold option', () => {
        // With threshold = 1, only OS (score 1) should be in the plan
        const strictPlan = generateImprovementPlan(SAMPLE_TOPICS, { weaknessThreshold: 1 });
        expect(strictPlan.map((p) => p.topic)).toEqual(['OS']);

        // With threshold = 4, OOP (score 4) should also be included
        const broadPlan = generateImprovementPlan(SAMPLE_TOPICS, { weaknessThreshold: 4 });
        expect(broadPlan.map((p) => p.topic)).toEqual(['OS', 'DBMS', 'SQL', 'OOP']);
      });

      it('limits actions per topic according to maxActionsPerTopic option', () => {
        const singleActionPlan = generateImprovementPlan(SAMPLE_TOPICS, { maxActionsPerTopic: 1 });
        expect(singleActionPlan[0].actions).toHaveLength(1);

        const defaultPlan = generateImprovementPlan(SAMPLE_TOPICS);
        expect(defaultPlan[0].actions.length).toBeGreaterThan(1);
        expect(defaultPlan[0].actions.length).toBeLessThanOrEqual(3);
      });
    });

    describe('Learning resource citation and validation (V-3)', () => {
      it('cites only valid resource IDs from V-3 (apps/api/src/data/resources.ts)', () => {
        const plan = generateImprovementPlan(SAMPLE_TOPICS);

        for (const topicPlan of plan) {
          expect(topicPlan.actions.length).toBeGreaterThan(0);
          for (const action of topicPlan.actions) {
            expect(isValidResourceId(action.resourceId)).toBe(true);
            expect(action.action).toBeTruthy();
            expect(action.completed).toBe(false);
          }
        }
      });

      it('rejects an unknown resource id via validateResourceId', () => {
        expect(() => validateResourceId('unknown-resource-xyz')).toThrow(InvalidResourceIdError);
        expect(() => validateResourceId('invalid-dbms-link')).toThrow(
          "Unknown resource id 'invalid-dbms-link' is not a vetted learning resource"
        );
      });

      it('accepts a valid resource id via validateResourceId', () => {
        expect(validateResourceId('dbms-acid-transactions')).toBe('dbms-acid-transactions');
      });

      it('rejects unknown resource ids in plan actions via validatePlanAction', () => {
        expect(() =>
          validatePlanAction({
            action: 'Read unofficial blog',
            resourceId: 'random-unvetted-id',
          })
        ).toThrow(InvalidResourceIdError);
      });

      it('rejects topic plan containing unknown resource ids via validateTopicPlan', () => {
        expect(() =>
          validateTopicPlan({
            topic: 'DBMS',
            score: 2,
            resourceId: 'non-existent-resource',
          })
        ).toThrow(InvalidResourceIdError);

        expect(() =>
          validateTopicPlan({
            topic: 'OS',
            score: 1,
            actions: [
              {
                action: 'Valid action',
                resourceId: 'os-three-easy-pieces',
              },
              {
                action: 'Invalid action',
                resourceId: 'fake-os-doc',
              },
            ],
          })
        ).toThrow(InvalidResourceIdError);
      });

      it('rejects improvement plan roadmap containing unknown resource ids via validateImprovementPlanRoadmap', () => {
        const invalidRoadmap = [
          {
            topic: 'SQL',
            score: 2,
            actions: [{ action: 'Do SQL exercises', resourceId: 'sql-queries-joins' }],
          },
          {
            topic: 'CN',
            score: 1,
            actions: [{ action: 'Invalid', resourceId: 'hallucinated-cn-resource' }],
          },
        ];

        expect(() => validateImprovementPlanRoadmap(invalidRoadmap)).toThrow(
          InvalidResourceIdError
        );
      });

      it('accepts and normalizes valid topic plans with curated resource IDs', () => {
        const validRoadmap = [
          {
            topic: 'DBMS',
            score: 2,
            actions: [
              {
                id: 'act-1',
                action: 'Review ACID properties',
                resourceId: 'dbms-acid-transactions',
              },
            ],
          },
        ];

        const validated = validateImprovementPlanRoadmap(validRoadmap);
        expect(validated).toHaveLength(1);
        expect(validated[0].topic).toBe('DBMS');
        expect(validated[0].actions[0].resourceId).toBe('dbms-acid-transactions');
      });
    });

    describe('Flattening and plan structure', () => {
      it('flattens a nested TopicPlan into individual RoadmapItems', () => {
        const plan = generateImprovementPlan(SAMPLE_TOPICS);
        const flat = flattenPlan(plan);

        expect(flat.length).toBeGreaterThan(0);
        expect(flat[0]).toHaveProperty('id');
        expect(flat[0]).toHaveProperty('topic');
        expect(flat[0]).toHaveProperty('score');
        expect(flat[0]).toHaveProperty('action');
        expect(flat[0]).toHaveProperty('resourceId');
        expect(flat[0]).toHaveProperty('completed', false);
        expect(isValidResourceId(flat[0].resourceId)).toBe(true);
      });
    });

    describe('Integration with refreshInsightsForUser', () => {
      it('generates and persists the roadmap plan along with topics in ImprovementPlan', async () => {
        (prisma.session.findMany as any).mockResolvedValueOnce(MOCK_SESSIONS);
        (prisma.improvementPlan.upsert as any).mockImplementationOnce(async ({ create }: any) => ({
          id: 'plan-123',
          userId: create.userId,
          topics: create.topics,
          plan: create.plan,
        }));

        const mockGenerate = vi.fn().mockResolvedValueOnce(JSON.stringify(MOCK_GEMINI_OUTPUT));
        const result: any = await refreshInsightsForUser(USER_ID, { generate: mockGenerate });

        expect(prisma.improvementPlan.upsert).toHaveBeenCalledWith({
          where: { userId: USER_ID },
          create: {
            userId: USER_ID,
            topics: MOCK_GEMINI_OUTPUT.topics,
            plan: expect.any(Array),
          },
          update: {
            topics: MOCK_GEMINI_OUTPUT.topics,
            plan: expect.any(Array),
          },
        });

        // The persisted plan must be ordered by weakness
        const savedPlan = (prisma.improvementPlan.upsert as any).mock.calls[0][0].create.plan;
        expect(savedPlan.length).toBeGreaterThan(0);
        expect(savedPlan[0].topic).toBe('DBMS'); // score 2 is weakest in MOCK_GEMINI_OUTPUT
        expect(savedPlan[0].score).toBe(2);

        // Every action in the saved plan cites valid resource IDs from V-3
        for (const item of savedPlan) {
          for (const act of item.actions) {
            expect(isValidResourceId(act.resourceId)).toBe(true);
          }
        }
      });
    });
  });
});

