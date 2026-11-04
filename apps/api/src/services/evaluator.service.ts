
// The only file that calls the evaluation LLM (FB4). Given a transcript and a
// role, it returns written feedback scored against the role-specific rubric (Issue #93).
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { FeedbackScore, ROLES, type TurnSpeaker } from '@interview/contracts';
import { getRubric, SOFTWARE_ENGINEER_RUBRIC } from './rubrics';

// Backwards compatibility export: default rubric for Software Engineer
export const RUBRIC = SOFTWARE_ENGINEER_RUBRIC;

// Leaves room inside the 15-second feedback budget for polling and the database.
export const EVALUATION_TIMEOUT_MS = 12_000;
// Pinned model, not the moving `gemini-flash-latest` alias, so scores don't drift.
const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface TranscriptTurn {
  speaker: TurnSpeaker;
  text: string;
}

export interface EvaluationInput {
  roleId?: string;
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

/**
 * Resolves the role ID from EvaluationInput, falling back to label lookup.
 */
export function resolveRoleId(input: EvaluationInput): string {
  if (input.roleId) {
    return input.roleId;
  }
  const normalized = input.roleLabel.trim().toLowerCase();
  const matched = ROLES.find(
    (r) => r.id.toLowerCase() === normalized || r.label.toLowerCase() === normalized
  );
  return matched?.id ?? input.roleLabel;
}

/**
 * Normalizes text by trimming, collapsing consecutive whitespace to single spaces,
 * and stripping surrounding quotation marks.
 */
export function normalizeQuote(text: string): string {
  return text
    .trim()
    .replace(/^["'“”]/, '')
    .replace(/["'“”]$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Validates whether a candidate quote appears verbatim in the candidate's transcript turns.
 */
export function isQuoteInCandidateTurns(quote: string, candidateTurns: TranscriptTurn[]): boolean {
  const normalizedQuote = normalizeQuote(quote);
  if (!normalizedQuote) {
    return false;
  }
  return candidateTurns.some((turn) => {
    const normalizedTurn = turn.text.replace(/\s+/g, ' ');
    return normalizedTurn.includes(normalizedQuote);
  });
}

/**
 * Strict server-side quote validation against candidate transcript text.
 * Throws an Error if any quote is missing, empty, or not found verbatim in candidate turns.
 */
export function validateEvaluationQuotes(scores: FeedbackScore[], turns: TranscriptTurn[]): void {
  const candidateTurns = turns.filter((t) => t.speaker === 'CANDIDATE');

  for (const item of scores) {
    if (!item.quote || !normalizeQuote(item.quote)) {
      throw new Error(`Quote validation failed: Quote for category "${item.category}" is empty`);
    }

    if (!isQuoteInCandidateTurns(item.quote, candidateTurns)) {
      throw new Error(
        `Quote validation failed: Quote for category "${item.category}" was not found in candidate transcript: "${item.quote}"`
      );
    }
  }
}

export function buildEvaluationPrompt(input: EvaluationInput): string {
  const roleId = resolveRoleId(input);
  const rubric = getRubric(roleId);

  const rubricText = rubric.map((r) => `- ${r.category}: ${r.criteria}`).join('\n');
  const transcript = input.turns
    .map((t) => `${t.speaker === 'AI' ? 'Interviewer' : 'Candidate'}: ${t.text}`)
    .join('\n');

  return `You are evaluating a mock job interview for the role "${input.roleLabel}".
Score ONLY the candidate's answers, using this role-specific rubric. Each score is an integer from 1 (poor) to 5 (excellent).
${rubricText}

Evaluation Instructions:
1. Technical & Role-Specific Evaluation:
   - Score the candidate strictly on the criteria listed for each category above.
   - Differentiate strong, concrete answers with specific depth and trade-offs from surface-level or vague explanations.

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
  ]
}
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

  const roleId = resolveRoleId(input);
  const rubric = getRubric(roleId);

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

  const expected = rubric.map((r) => r.category).sort();
  const received = evaluation.scores.map((s) => s.category).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received)) {
    throw new Error(`The evaluator scored [${received.join(', ')}] instead of the rubric categories`);
  }

  // Strict server-side quote validation against candidate transcript
  validateEvaluationQuotes(evaluation.scores, input.turns);

  return evaluation;
}
