import { GoogleGenAI } from '@google/genai';
import { AppError } from '../errors';
import { getOwnedSession, addTurn, listTurns, SessionEndedError } from './session.service';
import { briefingFor } from './briefing.service';
import type { EvaluationUsageMetadata } from './evaluator.service';
import { recordNextQuestionUsage } from './feedback.service';

export const NEXT_QUESTION_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'gemini-3.8-flash';

export class InterviewerTimeoutError extends AppError {
  constructor(message = 'Question generation timed out, please try again') {
    super(503, message);
  }
}

export interface GenerateQuestionResult {
  text: string;
  usageMetadata?: EvaluationUsageMetadata;
}

export interface NextQuestionOptions {
  generate?: (prompt: string) => Promise<string | GenerateQuestionResult>;
  timeoutMs?: number;
  remainingSeconds?: number;
}

export function buildNextQuestionPrompt(
  briefing: string,
  turns: Array<{ speaker: 'AI' | 'CANDIDATE'; text: string }>,
  options: { remainingSeconds?: number } = {}
): string {
  const formattedTurns =
    turns.length > 0
      ? turns.map((t) => `${t.speaker === 'AI' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n')
      : '(No turns yet. This is the start of the interview.)';

  const isWrapUp = options.remainingSeconds !== undefined && options.remainingSeconds <= 120;

  return `${briefing}

CURRENT INTERVIEW TRANSCRIPT SO FAR:
${formattedTurns}

TASK:
You are the technical interviewer. Based on the role briefing instructions and transcript history above:
${
  isWrapUp
    ? `- 2 MINUTES OR LESS REMAIN IN THE INTERVIEW: You MUST begin the closing wrap-up phase. Ask one final question, invite closing remarks or any questions from the candidate, and thank them warmly for their time. Do NOT introduce new technical deep-dive topics.`
    : `- If there are no turns yet, ask your opening warm-up question.
- If the candidate just answered, ask a relevant follow-up question or transition to the next technical topic based on your briefing.`
}
- Do NOT repeat questions already asked.
- Ask exactly ONE clear, concise question to be spoken aloud or displayed to the candidate.
- Return ONLY the question text. Do NOT include prefixes like 'Interviewer:', quotation marks, or markdown bullet points.`;
}

async function callGemini(prompt: string, timeoutMs: number): Promise<GenerateQuestionResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  const model = process.env.GEMINI_EVAL_MODEL?.trim() || DEFAULT_MODEL;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.7,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });

    const usageMetadata: EvaluationUsageMetadata | undefined = response.usageMetadata
      ? {
          promptTokenCount: response.usageMetadata.promptTokenCount,
          candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
          totalTokenCount: response.usageMetadata.totalTokenCount,
        }
      : undefined;

    return {
      text: response.text ?? '',
      ...(usageMetadata ? { usageMetadata } : {}),
    };
  } catch (err) {
    // The abort signal rejects with a TimeoutError or AbortError once the time is up.
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new InterviewerTimeoutError();
    }
    throw err;
  }
}

/**
 * Generates the next AI question for an active session using Gemini Flash and saves it as an AI turn.
 */
export async function generateNextQuestion(
  sessionId: string,
  userId: string,
  options: NextQuestionOptions = {}
) {
  const session = await getOwnedSession(sessionId, userId);

  if (session.status !== 'LIVE') {
    throw new SessionEndedError();
  }

  const turns = await listTurns(sessionId, userId);

  const briefing = await briefingFor(session);
  const prompt = buildNextQuestionPrompt(briefing, turns, {
    remainingSeconds: options.remainingSeconds,
  });
  const timeoutMs = options.timeoutMs ?? NEXT_QUESTION_TIMEOUT_MS;

  const generate = options.generate ?? ((p: string) => callGemini(p, timeoutMs));
  const rawResponse = await generate(prompt);

  const rawQuestion = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;
  const usageMetadata =
    typeof rawResponse === 'object' && rawResponse !== null
      ? rawResponse.usageMetadata
      : undefined;

  const questionText = rawQuestion
    .trim()
    .replace(/^Interviewer:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  if (!questionText) {
    throw new Error('Generated question was empty');
  }

  if (usageMetadata) {
    await recordNextQuestionUsage(sessionId, usageMetadata);
  }

  return addTurn(sessionId, userId, 'AI', questionText);
}
