// The only file that calls the evaluation LLM. Given a transcript and a
// role, it returns written feedback scored against that role's rubric.
import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { z } from 'zod';
import { FeedbackScore, ROLES, type TurnSpeaker } from '@interview/contracts';
import { getRubric, TECHNOLOGY_INDEPENDENCE_PRINCIPLE, SCORE_SEPARATION_PRINCIPLE } from './rubrics';

// Leaves room inside the 15-second feedback budget for polling and the database.
export const EVALUATION_TIMEOUT_MS = 12_000;
// A pinned model, not the moving `gemini-flash-latest` alias, so scores don't drift when
// Google swaps the model behind the alias.
const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface TranscriptTurn {
  speaker: TurnSpeaker;
  text: string;
}

export interface EvaluationInput {
  roleId: string;
  turns: TranscriptTurn[];
}

export interface EvaluationUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

const Evaluation = z.object({
  summary: z.string().min(1),
  scores: z.array(FeedbackScore),
});
export type Evaluation = z.infer<typeof Evaluation> & {
  usageMetadata?: EvaluationUsageMetadata;
};

export interface GenerateResult {
  text: string;
  usageMetadata?: EvaluationUsageMetadata;
}

export interface EvaluatorOptions {
  // Replaces the Gemini call; tests use it so no test reaches the real API.
  generate?: (prompt: string) => Promise<GenerateResult>;
  timeoutMs?: number;
}

export function buildEvaluationPrompt({ roleId, turns }: EvaluationInput): string {
  const roleLabel = ROLES.find((r) => r.id === roleId)?.label ?? roleId;
  const rubric = getRubric(roleId)
    .map((r) => `- ${r.category}: ${r.criteria}`)
    .join('\n');
  const transcript = turns
    .map((t) => `${t.speaker === 'AI' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n');
  return `You are evaluating a mock job interview for the role "${roleLabel}".
Score ONLY the candidate's answers, using this rubric. Each score is an integer from 1 (poor) to 5 (excellent).
${rubric}

Evaluation Instructions:
1. Technical & Role-Specific Evaluation:
   - Score the candidate strictly on the criteria listed for each category above.
   - Differentiate strong, concrete answers with specific depth and trade-offs from surface-level or vague explanations.
   - Technology-independent evaluation: ${TECHNOLOGY_INDEPENDENCE_PRINCIPLE}
   - Score separation (technical depth vs. communication): ${SCORE_SEPARATION_PRINCIPLE}
   - Technical categories (e.g. Problem Solving & Algorithms, Software Design & Architecture, SQL & Analytical Reasoning, Data Interpretation & Business Insights, Statistical Understanding & Data Quality, API Design & Architecture, Database Modeling & Performance, System Reliability & Scalability) must be evaluated based on the substance, correctness, analytical depth, and architectural/algorithmic validity of the candidate's solution, ignoring speech disfluencies.
   - Pauses, fillers, and hesitation must be evaluated solely under communication categories (e.g., Technical Communication). If a role rubric does not contain a dedicated communication category (such as Data Analyst or Backend Developer), pauses, verbal fillers, and speech disfluencies must NEVER reduce any category score; all categories must be judged strictly on content and correctness.

2. Behavioural Evaluation (STAR Methodology):
   - For questions and answers that are behavioural (e.g. discussing past experiences, conflicts, challenges, leadership, or teamwork), assess the answer structure using the STAR framework:
     * Situation: Did the candidate clearly establish the context and background?
     * Task: Did the candidate define their specific responsibility or goal?
     * Action: Did the candidate explain the concrete actions they personally took?
     * Result: Did the candidate share the quantifiable outcome or business impact?
   - DO NOT force STAR onto purely technical, architectural, coding, or conceptual questions where STAR is irrelevant. Do NOT penalize candidates for omitting STAR components in technical answers.

3. Feedback & Transcript Evidence:
   - Base every evaluation, strength, improvement, and quote strictly on what the candidate actually said.
   - For every category, provide:
     * category: the rubric category name exactly as written above.
     * score: integer from 1 (poor) to 5 (excellent).
     * comment: one or two concise sentences explaining why this score was given, citing specific technical or communication justification.
     * strengths: array of 1-2 specific things the candidate did well.
     * improvements: array of 1-2 actionable recommendations for improvement.
     * quote: an exact, verbatim excerpt from the candidate's transcript answers providing direct evidence for this category. Never use interviewer statements. Never fabricate or paraphrase quotes.

Return ONLY JSON of this shape:
{
  "summary": "<2-3 sentences of overall feedback addressed to the candidate>",
  "scores": [
    {
      "category": "<rubric category, exactly as written above>",
      "score": <1-5>,
      "comment": "<one or two sentences explaining why this score was given>",
      "strengths": ["<strength 1>", "<strength 2>"],
      "improvements": ["<improvement 1>"],
      "quote": "<exact verbatim quote from candidate transcript text>"
    }
  ]
}
Include every rubric category exactly once.

Transcript:
${transcript}`;
}

// Structured output: Gemini must return exactly this shape, with categories limited to the rubric's.
export function evaluationSchema(categories: string[]): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      summary: { type: Type.STRING },
      scores: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, enum: categories },
            score: { type: Type.INTEGER },
            comment: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
            quote: { type: Type.STRING },
          },
          required: ['category', 'score', 'comment', 'strengths', 'improvements', 'quote'],
        },
      },
    },
    required: ['summary', 'scores'],
  };
}

async function generateWithGemini(
  prompt: string,
  categories: string[],
  timeoutMs: number
): Promise<GenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_EVAL_MODEL?.trim() || DEFAULT_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: evaluationSchema(categories),
      temperature: 0.2,
      // Cancels the HTTP request itself when the time is up, not just our wait for it.
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  return {
    text: response.text ?? '',
    usageMetadata: response.usageMetadata
      ? {
          promptTokenCount: response.usageMetadata.promptTokenCount,
          candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
          totalTokenCount: response.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Evaluation timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function evaluateTranscript(
  input: EvaluationInput,
  options: EvaluatorOptions = {}
): Promise<Evaluation> {
  if (!input.turns.some((t) => t.speaker === 'CANDIDATE' && t.text.trim())) {
    throw new Error('The transcript has no candidate answers to evaluate');
  }

  const timeoutMs = options.timeoutMs ?? EVALUATION_TIMEOUT_MS;
  const categories = getRubric(input.roleId).map((r) => r.category);
  const prompt = buildEvaluationPrompt(input);
  const generate = options.generate ?? ((p: string) => generateWithGemini(p, categories, timeoutMs));
  const result = await withTimeout(generate(prompt), timeoutMs);
  const text = result.text;
  const usageMetadata = result.usageMetadata;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The evaluator did not return valid JSON');
  }
  const evaluation = Evaluation.parse(json);

  const expected = [...categories].sort();
  const received = evaluation.scores.map((s) => s.category).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) {
    throw new Error(`The evaluator scored [${received.join(', ')}] instead of the rubric categories`);
  }
  return {
    ...evaluation,
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}
