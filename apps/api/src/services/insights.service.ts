import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { z } from 'zod';
import type { ImprovementPlan, Job, Prisma } from '../generated/prisma/client';
import prisma from '../db';
import {
  isValidResourceId,
  getResourcesByTopic,
  normalizeTopic,
} from '../data/resources';

export const INSIGHT_TOPICS = [
  'DBMS',
  'OOP',
  'OS',
  'CN',
  'DSA',
  'SQL',
  'System Design',
] as const;

export type InsightTopic = (typeof INSIGHT_TOPICS)[number];

export const TopicScoreSchema = z.object({
  topic: z.enum(INSIGHT_TOPICS),
  score: z.number().int().min(1).max(5),
  summary: z.string().optional(),
});
export type TopicScore = z.infer<typeof TopicScoreSchema>;

export const InsightsOutputSchema = z.object({
  topics: z.array(TopicScoreSchema),
});
export type InsightsOutput = z.infer<typeof InsightsOutputSchema>;

// V-4: Improvement roadmap schemas, types, and resource validation
export const PlanActionSchema = z.object({
  id: z.string(),
  action: z.string().min(1),
  resourceId: z.string().min(1),
  completed: z.boolean().default(false),
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const TopicPlanSchema = z.object({
  id: z.string().optional(),
  topic: z.enum(INSIGHT_TOPICS),
  score: z.number().int().min(1).max(5),
  summary: z.string().optional(),
  action: z.string().optional(),
  resourceId: z.string().optional(),
  actions: z.array(PlanActionSchema).default([]),
});
export type TopicPlan = z.infer<typeof TopicPlanSchema>;

export const RoadmapItemSchema = z.object({
  id: z.string(),
  topic: z.enum(INSIGHT_TOPICS),
  score: z.number().int().min(1).max(5),
  action: z.string(),
  resourceId: z.string(),
  completed: z.boolean().default(false),
});
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export class InvalidResourceIdError extends Error {
  constructor(public readonly resourceId: string) {
    super(`Unknown resource id '${resourceId}' is not a vetted learning resource`);
    this.name = 'InvalidResourceIdError';
  }
}

export function validateResourceId(resourceId: string): string {
  if (!resourceId || !isValidResourceId(resourceId)) {
    throw new InvalidResourceIdError(resourceId);
  }
  return resourceId;
}

export function validatePlanAction(action: {
  id?: string;
  action: string;
  resourceId: string;
  completed?: boolean;
}): PlanAction {
  if (!action.resourceId || !isValidResourceId(action.resourceId)) {
    throw new InvalidResourceIdError(action.resourceId ?? 'undefined');
  }
  return {
    id: action.id ?? `${action.resourceId}-action`,
    action: action.action,
    resourceId: action.resourceId,
    completed: action.completed ?? false,
  };
}

export function validateTopicPlan(item: {
  id?: string;
  topic: string;
  score: number;
  summary?: string;
  action?: string;
  resourceId?: string;
  actions?: Array<{
    id?: string;
    action: string;
    resourceId: string;
    completed?: boolean;
  }>;
}): TopicPlan {
  const normalizedTopic = normalizeTopic(item.topic);
  if (!normalizedTopic) {
    throw new Error(`Invalid topic: ${item.topic}`);
  }
  if (item.resourceId && !isValidResourceId(item.resourceId)) {
    throw new InvalidResourceIdError(item.resourceId);
  }
  const validatedActions: PlanAction[] = [];
  if (Array.isArray(item.actions) && item.actions.length > 0) {
    for (const act of item.actions) {
      validatedActions.push(validatePlanAction(act));
    }
  } else if (item.action && item.resourceId) {
    validatedActions.push(
      validatePlanAction({
        id: item.id ?? `${item.resourceId}-action`,
        action: item.action,
        resourceId: item.resourceId,
      })
    );
  }
  return {
    id: item.id,
    topic: normalizedTopic as InsightTopic,
    score: item.score,
    summary: item.summary,
    action: item.action ?? validatedActions[0]?.action,
    resourceId: item.resourceId ?? validatedActions[0]?.resourceId,
    actions: validatedActions,
  };
}

export function validateImprovementPlanRoadmap(plan: unknown[]): TopicPlan[] {
  if (!Array.isArray(plan)) {
    throw new Error('Improvement plan roadmap must be an array');
  }
  return plan.map((item) => validateTopicPlan(item as any));
}

export const WEAKNESS_THRESHOLD = 3;

export interface GeneratePlanOptions {
  weaknessThreshold?: number;
  maxActionsPerTopic?: number;
}

/**
 * Generates an ordered plan of weak topics with concrete actions,
 * citing only validated resource IDs from V-3 (apps/api/src/data/resources.ts).
 * The plan is ordered strictly by weakness (lowest score first).
 */
export function generateImprovementPlan(
  topics: TopicScore[],
  options: GeneratePlanOptions = {}
): TopicPlan[] {
  const threshold = options.weaknessThreshold ?? WEAKNESS_THRESHOLD;
  const maxActions = options.maxActionsPerTopic ?? 3;

  // Filter weak topics only (scores <= threshold)
  const weakTopics = topics.filter((t) => t.score <= threshold);

  // Ordered by weakness: lowest score first (1, then 2, then 3).
  // Ties broken alphabetically by topic name for deterministic output.
  weakTopics.sort((a, b) => a.score - b.score || a.topic.localeCompare(b.topic));

  return weakTopics.map((t) => {
    const resources = getResourcesByTopic(t.topic).slice(0, maxActions);
    const actions: PlanAction[] = resources.map((r) => {
      validateResourceId(r.id);
      return {
        id: `${t.topic.toLowerCase()}-${r.id}`,
        action: `Study ${r.title} to improve ${t.topic} foundations (${r.type}: ${r.description})`,
        resourceId: r.id,
        completed: false,
      };
    });

    return {
      id: `plan-${t.topic.toLowerCase()}`,
      topic: t.topic,
      score: t.score,
      summary: t.summary,
      action: actions[0]?.action,
      resourceId: actions[0]?.resourceId,
      actions,
    };
  });
}

/**
 * Flattens a TopicPlan array into a flat list of RoadmapItem steps.
 */
export function flattenPlan(plan: TopicPlan[]): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  for (const p of plan) {
    for (const act of p.actions) {
      items.push({
        id: act.id,
        topic: p.topic,
        score: p.score,
        action: act.action,
        resourceId: act.resourceId,
        completed: act.completed ?? false,
      });
    }
  }
  return items;
}

export interface GenerateResult {
  text: string;
}

export interface InsightsOptions {
  generate?: (prompt: string) => Promise<string | GenerateResult>;
  timeoutMs?: number;
}

export const INSIGHTS_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'gemini-3.8-flash';

export function topicInsightsSchema(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      topics: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              enum: [...INSIGHT_TOPICS],
            },
            score: {
              type: Type.INTEGER,
            },
            summary: {
              type: Type.STRING,
            },
          },
          required: ['topic', 'score'],
        },
      },
    },
    required: ['topics'],
  };
}

export interface SessionWithFeedbackAndTurns {
  role: string;
  turns: Array<{ speaker: string; text: string }>;
  feedback?: {
    summary?: string | null;
    scores?: unknown;
  } | null;
}

export function buildInsightsPrompt(sessions: SessionWithFeedbackAndTurns[]): string {
  let context = 'Candidate Interview History and Feedback:\n\n';

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    context += `--- Session ${i + 1} (${s.role}) ---\n`;
    if (s.feedback) {
      if (s.feedback.summary) {
        context += `Feedback Summary: ${s.feedback.summary}\n`;
      }
      if (Array.isArray(s.feedback.scores) && s.feedback.scores.length > 0) {
        context += `Category Scores:\n`;
        for (const score of s.feedback.scores as any[]) {
          context += `- ${score.category}: Score ${score.score}/5. ${score.comment ?? ''}\n`;
          if (Array.isArray(score.strengths) && score.strengths.length > 0) {
            context += `  Strengths: ${score.strengths.join('; ')}\n`;
          }
          if (Array.isArray(score.improvements) && score.improvements.length > 0) {
            context += `  Improvements: ${score.improvements.join('; ')}\n`;
          }
          if (score.quote) {
            context += `  Quote: "${score.quote}"\n`;
          }
        }
      }
    }
    const candidateTurns = s.turns.filter((t) => t.speaker === 'CANDIDATE' && t.text.trim());
    if (candidateTurns.length > 0) {
      context += `Candidate Transcript Answers:\n`;
      for (const t of candidateTurns) {
        context += `- Candidate: "${t.text}"\n`;
      }
    }
    context += '\n';
  }

  return `You are an expert technical interviewer and mentor evaluating a candidate's technical strengths and weaknesses across their recent mock interviews.
Analyze the provided interview feedback, category scores, and transcript answers to map their demonstrated technical knowledge to the following 7 topics:
- DBMS
- OOP
- OS
- CN
- DSA
- SQL
- System Design

For each topic evaluated, provide:
1. "topic": Exactly one of the 7 topics (DBMS, OOP, OS, CN, DSA, SQL, System Design).
2. "score": An integer strength score from 1 (poor/weak) to 5 (excellent/strong):
   - 1: Major conceptual gaps, poor or incorrect answers.
   - 2: Weak grasp, struggled with core technical trade-offs or implementations.
   - 3: Adequate basic understanding, but lacking technical depth.
   - 4: Solid understanding, clearly explains trade-offs and concepts.
   - 5: Expert mastery, deep technical precision and optimal solutions.
3. "summary": A concise sentence or two explaining the candidate's demonstrated performance in this topic.

Evaluation Guidelines:
- Base scores on evidence from the candidate's answers and feedback.
- Map concepts appropriately (e.g., normalization/transactions -> DBMS, queries/joins -> SQL, threads/processes/memory -> OS, networking/HTTP/TCP -> CN, class design/design patterns/SOLID -> OOP, complexity/trees/algorithms -> DSA, architecture/scalability/caching -> System Design).
- Provide scores for the topics covered or assessed in the sessions.

${context}

Return ONLY valid JSON matching this schema:
{
  "topics": [
    {
      "topic": "<one of: DBMS, OOP, OS, CN, DSA, SQL, System Design>",
      "score": <integer 1 to 5>,
      "summary": "<concise explanation>"
    }
  ]
}`;
}

async function generateWithGemini(
  prompt: string,
  timeoutMs: number
): Promise<GenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  const response = await ai.models.generateContent({
    model:
      process.env.GEMINI_INSIGHTS_MODEL?.trim() ||
      process.env.GEMINI_EVAL_MODEL?.trim() ||
      DEFAULT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: topicInsightsSchema(),
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  return {
    text: response.text ?? '',
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Insights generation timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Maps recent feedback and transcripts for a user to technical topics (DBMS, OOP, OS, CN, DSA, SQL, System Design),
 * each with a strength score, and stores the resulting topics in the ImprovementPlan table.
 */
export async function refreshInsightsForUser(
  userId: string,
  options: InsightsOptions = {}
): Promise<ImprovementPlan> {
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      status: 'ENDED',
    },
    include: {
      feedback: true,
      turns: {
        orderBy: { turnIndex: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const validSessions = sessions.filter(
    (s) => s.feedback?.status === 'ready' || s.turns.some((t) => t.speaker === 'CANDIDATE' && t.text.trim())
  );

  if (validSessions.length === 0) {
    return prisma.improvementPlan.upsert({
      where: { userId },
      create: {
        userId,
        topics: [],
        plan: [],
      },
      update: {
        topics: [],
        plan: [],
      },
    });
  }

  const timeoutMs = options.timeoutMs ?? INSIGHTS_TIMEOUT_MS;
  const prompt = buildInsightsPrompt(validSessions);
  const generate = options.generate ?? ((p: string) => generateWithGemini(p, timeoutMs));

  const rawResult = await withTimeout(generate(prompt), timeoutMs);
  const text = typeof rawResult === 'string' ? rawResult : rawResult.text;

  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  }

  let json: unknown;
  try {
    json = JSON.parse(cleanText);
  } catch {
    throw new Error('The insights generator did not return valid JSON');
  }

  const parsed = InsightsOutputSchema.parse(json);
  const plan = generateImprovementPlan(parsed.topics);

  return prisma.improvementPlan.upsert({
    where: { userId },
    create: {
      userId,
      topics: parsed.topics as unknown as Prisma.InputJsonValue,
      plan: plan as unknown as Prisma.InputJsonValue,
    },
    update: {
      topics: parsed.topics as unknown as Prisma.InputJsonValue,
      plan: plan as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Job handler for the `insights.refresh` job type.
 */
export async function handleInsightsRefresh(
  job: Job,
  options: InsightsOptions = {}
): Promise<void> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;
  let userId = typeof payload.userId === 'string' ? payload.userId : undefined;

  if (!userId && job.sessionId) {
    const session = await prisma.session.findUnique({
      where: { id: job.sessionId },
      select: { userId: true },
    });
    userId = session?.userId;
  }

  if (!userId) {
    throw new Error(`Job ${job.id} has no userId and cannot resolve session`);
  }

  await refreshInsightsForUser(userId, options);
}

/**
 * Retrieves the current ImprovementPlan for a candidate.
 */
export async function getImprovementPlan(userId: string): Promise<ImprovementPlan | null> {
  return prisma.improvementPlan.findUnique({
    where: { userId },
  });
}

