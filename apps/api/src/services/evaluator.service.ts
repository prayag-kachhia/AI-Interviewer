// The only file that calls the evaluation LLM. Given a transcript and a
// role, it returns written feedback scored against that role's rubric.
import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { z } from 'zod';
import { FeedbackScore, PerAnswerFeedback, ROLES, type TurnSpeaker } from '@interview/contracts';
import { getRubric, TECHNOLOGY_INDEPENDENCE_PRINCIPLE } from './rubrics';

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
  perAnswer: z.array(PerAnswerFeedback).optional(),
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
  requirePerAnswer?: boolean;
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
     * comment: one or two concise sentences summarizing the evaluation.
     * strengths: array of 1-2 specific things the candidate did well.
     * improvements: array of 1-2 actionable recommendations for improvement.
     * quote: an exact, verbatim excerpt from the candidate's transcript answers providing direct evidence for this category. Never use interviewer statements. Never fabricate or paraphrase quotes.

4. Per-Answer Feedback (for each candidate answer):
   - For every question answered by the candidate in the transcript, generate an item in \`perAnswer\`:
     * question: the exact interviewer question that prompted this answer.
     * summary: a concise, one-line summary of the candidate's answer.
     * strengths: array of 1-2 specific strengths demonstrated in this answer.
     * improvements: array of 1-2 actionable recommendations to improve this specific answer.
   - Maintain chronological order matching the sequence of candidate answers.
   - Provide feedback ONLY for candidate answers; NEVER generate feedback entries for interviewer questions.
   - Do NOT combine multiple unrelated candidate answers into one entry.
   - Base feedback strictly on evidence from that specific answer.

Return ONLY JSON of this shape:
{
  "summary": "<2-3 sentences of overall feedback addressed to the candidate>",
  "scores": [
    {
      "category": "<rubric category, exactly as written above>",
      "score": <1-5>,
      "comment": "<one or two sentences>",
      "strengths": ["<strength 1>", "<strength 2>"],
      "improvements": ["<improvement 1>"],
      "quote": "<exact verbatim quote from candidate transcript text>"
    }
  ],
  "perAnswer": [
    {
      "question": "<exact interviewer question>",
      "summary": "<concise one-line summary of candidate's answer>",
      "strengths": ["<strength 1>"],
      "improvements": ["<improvement 1>"]
    }
  ]
}
Include every rubric category exactly once.
Include per-answer feedback for every candidate answer in chronological order.

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
      perAnswer: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            summary: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['question', 'summary', 'strengths', 'improvements'],
        },
      },
    },
    required: ['summary', 'scores', 'perAnswer'],
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

/**
 * Normalizes whitespace for question comparison: collapses runs of
 * whitespace to a single space and trims leading/trailing whitespace.
 */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Derives the expected interviewer question for each non-empty candidate
 * answer by walking the transcript in chronological order.  For each
 * non-empty CANDIDATE turn, the expected question is the text of the most
 * recent preceding non-empty AI turn.
 *
 * Returns `null` for a candidate answer that has no preceding AI turn.
 */
export function deriveExpectedQuestions(
  turns: TranscriptTurn[]
): (string | null)[] {
  const result: (string | null)[] = [];
  let lastAiText: string | null = null;
  for (const turn of turns) {
    if (turn.speaker === 'AI' && turn.text.trim()) {
      lastAiText = turn.text;
    } else if (turn.speaker === 'CANDIDATE' && turn.text.trim()) {
      result.push(lastAiText);
    }
  }
  return result;
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
  const candidateTurns = input.turns.filter((t) => t.speaker === 'CANDIDATE' && t.text.trim());
  if (candidateTurns.length === 0) {
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

  if (options.requirePerAnswer && !evaluation.perAnswer) {
    throw new Error('The evaluator did not return per-answer feedback');
  }

  if (evaluation.perAnswer) {
    if (evaluation.perAnswer.length < candidateTurns.length) {
      throw new Error(
        `Incomplete per-answer feedback: expected ${candidateTurns.length} answer(s) but received ${evaluation.perAnswer.length}`
      );
    }
    if (evaluation.perAnswer.length > candidateTurns.length) {
      throw new Error(
        `Too many per-answer feedback entries: expected ${candidateTurns.length} answer(s) but received ${evaluation.perAnswer.length}`
      );
    }
    for (let i = 0; i < evaluation.perAnswer.length; i++) {
      const item = evaluation.perAnswer[i];
      if (!item.question || !item.question.trim()) {
        throw new Error(`Per-answer feedback entry ${i + 1} is missing the associated question`);
      }
      if (!item.summary || !item.summary.trim()) {
        throw new Error(`Per-answer feedback entry ${i + 1} is missing the answer summary`);
      }
      if (
        !Array.isArray(item.strengths) ||
        item.strengths.length === 0 ||
        item.strengths.some((s) => typeof s !== 'string' || !s.trim())
      ) {
        throw new Error(`Per-answer feedback entry ${i + 1} must contain at least one non-empty strength`);
      }
      if (
        !Array.isArray(item.improvements) ||
        item.improvements.length === 0 ||
        item.improvements.some((s) => typeof s !== 'string' || !s.trim())
      ) {
        throw new Error(`Per-answer feedback entry ${i + 1} must contain at least one non-empty improvement`);
      }
    }

    // Validate question-answer pairing: each perAnswer[i].question must match
    // the most recent preceding AI turn for the i-th non-empty candidate answer.
    const expectedQuestions = deriveExpectedQuestions(input.turns);
    for (let i = 0; i < evaluation.perAnswer.length; i++) {
      const expected = expectedQuestions[i];
      if (expected === null) {
        throw new Error(
          `Per-answer feedback entry ${i + 1} has no preceding interviewer question in the transcript`
        );
      }
      const returned = evaluation.perAnswer[i].question;
      if (normalizeWhitespace(returned) !== normalizeWhitespace(expected)) {
        throw new Error(
          `Per-answer feedback entry ${i + 1} question does not match the transcript. ` +
          `Expected: "${expected.slice(0, 80)}..." but received: "${returned.slice(0, 80)}..."`
        );
      }
    }
  }

  return {
    ...evaluation,
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}
