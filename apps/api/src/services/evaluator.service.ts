// The only file that calls the evaluation LLM. Given a transcript and a
// role, it returns written feedback scored against the generic rubric.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { FeedbackScore, type TurnSpeaker } from '@interview/contracts';

// One generic rubric for every role in Sprint 1.
// Changing it needs the lead's approval.
export const RUBRIC = [
  {
    category: 'Communication',
    criteria: 'Answers are clear, concise and easy to follow; the candidate explains their thinking.',
  },
  {
    category: 'Technical depth',
    criteria: 'Answers show correct, specific knowledge for the role, including trade-offs, not just definitions.',
  },
  {
    category: 'Structure',
    criteria: 'Answers are organised (context, approach, result) and stay on the question asked.',
  },
] as const;

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
  roleLabel: string;
  turns: TranscriptTurn[];
}

const Evaluation = z.object({
  summary: z.string().min(1),
  scores: z.array(FeedbackScore),
});
export type Evaluation = z.infer<typeof Evaluation>;

export interface EvaluatorOptions {
  // Replaces the Gemini call; tests use it so no test reaches the real API.
  generate?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
}

export function buildEvaluationPrompt({ roleLabel, turns }: EvaluationInput): string {
  const rubric = RUBRIC.map((r) => `- ${r.category}: ${r.criteria}`).join('\n');
  const transcript = turns
    .map((t) => `${t.speaker === 'AI' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n');
  return `You are evaluating a mock job interview for the role "${roleLabel}".
Score ONLY the candidate's answers, using this rubric. Each score is an integer from 1 (poor) to 5 (excellent).
${rubric}

Base every comment on what the candidate actually said in the transcript. Do not invent answers.

Return ONLY JSON of this shape:
{"summary": "<2-3 sentences of overall feedback addressed to the candidate>",
 "scores": [{"category": "<rubric category, exactly as written above>", "score": <1-5>, "comment": "<one or two sentences>"}]}
Include every rubric category exactly once.

Transcript:
${transcript}`;
}

async function generateWithGemini(prompt: string, timeoutMs: number): Promise<string> {
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
      temperature: 0.2,
      // Cancels the HTTP request itself when the time is up, not just our wait for it.
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  return response.text ?? '';
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
  const prompt = buildEvaluationPrompt(input);
  const generate = options.generate ?? ((p: string) => generateWithGemini(p, timeoutMs));
  const raw = await withTimeout(generate(prompt), timeoutMs);

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('The evaluator did not return valid JSON');
  }
  const evaluation = Evaluation.parse(json);

  const expected = RUBRIC.map((r) => r.category).sort();
  const received = evaluation.scores.map((s) => s.category).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) {
    throw new Error(`The evaluator scored [${received.join(', ')}] instead of the rubric categories`);
  }
  return evaluation;
}
