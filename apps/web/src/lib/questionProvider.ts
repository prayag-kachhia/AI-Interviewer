import type { TurnData, TurnSpeaker } from '../types';

export interface TranscriptTurnSummary {
  speaker: TurnSpeaker;
  text: string;
}

/**
 * Clean interface for the Interviewer Question Provider consumed by LS4.
 *
 * ARCHITECTURAL BOUNDARY:
 * - There are two separate LLM roles in the platform:
 *   1. INTERVIEWER Question Provider (generates live interview questions & follow-ups).
 *   2. FEEDBACK Evaluator LLM (owned by the Feedback team / FB4, which consumes the
 *      `session.ended` job and evaluates the stored transcript).
 * - Because no external Interviewer LLM service is wired in this repository yet,
 *   `DeterministicQuestionProvider` provides a deterministic local-development stub
 *   that demonstrates the exact `previous candidate answer -> question provider -> next question`
 *   pipeline without claiming to call an external LLM.
 */
export interface InterviewQuestionProvider {
  readonly isStub: boolean;
  getInitialQuestion(role: string): string;
  getNextQuestion(role: string, transcript: Array<Pick<TurnData, 'speaker' | 'text'>>): string | null;
}

const ROLE_QUESTION_BANK: Record<string, string[]> = {
  'software-engineer': [
    'Tell me about yourself and what excites you about software engineering.',
    'Can you walk me through a project you are proud of and explain your specific role?',
    'How would you diagnose and resolve a performance bottleneck in a production web application?',
    'Tell me about a time you navigated a technical disagreement or difficult bug with a teammate.',
    'Do you have any questions for me about the engineering team or role before we wrap up?',
  ],
  'data-analyst': [
    'Tell me about yourself and what draws you to data analysis.',
    'Can you walk me through a project where you turned raw data into a concrete decision?',
    'How do you validate data accuracy and choose the clearest visualization for stakeholders?',
    'Tell me about a time you caught an unexpected anomaly or mistake in your analysis. How did you handle it?',
    'Do you have any questions for me before we wrap up the interview?',
  ],
  'backend-developer': [
    'Tell me about yourself and your experience designing backend systems.',
    'Can you walk me through an API or database architecture you built and explain your key design trade-offs?',
    'How do you approach debugging a slow database query or high-latency endpoint under load?',
    'Tell me about how you ensure transactional integrity and graceful failure handling in backend services.',
    'Do you have any questions for me before we finish today?',
  ],
};

const DEFAULT_SCRIPT = ROLE_QUESTION_BANK['software-engineer'];

function extractCandidateTopicSnippet(candidateText: string): string | null {
  const cleaned = candidateText.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const firstClause = cleaned
    .split(/[.!?;]+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 6) ?? cleaned;

  const stripped = firstClause.replace(/^(hi|hello|hey|well|so|um|uh)[,\s]+/i, '').trim();
  const words = stripped.split(' ');
  const snippet = words.length <= 9 ? stripped : `${words.slice(0, 9).join(' ')}...`;
  return snippet || null;
}

export class DeterministicQuestionProvider implements InterviewQuestionProvider {
  public readonly isStub = true;

  getInitialQuestion(role: string): string {
    const script = ROLE_QUESTION_BANK[role] ?? DEFAULT_SCRIPT;
    return script[0];
  }

  getNextQuestion(
    role: string,
    transcript: Array<Pick<TurnData, 'speaker' | 'text'>>
  ): string | null {
    const script = ROLE_QUESTION_BANK[role] ?? DEFAULT_SCRIPT;

    const askedAiTurns = transcript
      .filter((t) => t.speaker === 'AI')
      .map((t) => t.text.trim().toLowerCase());

    const candidateTurns = transcript.filter((t) => t.speaker === 'CANDIDATE');
    const lastCandidateTurn = candidateTurns[candidateTurns.length - 1];

    for (let index = 0; index < script.length; index++) {
      const baseQuestion = script[index];
      const alreadyAsked = askedAiTurns.some(
        (asked) =>
          asked === baseQuestion.toLowerCase() ||
          asked.endsWith(baseQuestion.toLowerCase())
      );

      if (!alreadyAsked) {
        // Follow-up behavior: refer to the immediately preceding candidate answer
        if (index === 1 && lastCandidateTurn?.text) {
          const snippet = extractCandidateTopicSnippet(lastCandidateTurn.text);
          if (snippet) {
            return `You mentioned "${snippet}" — ${baseQuestion.charAt(0).toLowerCase()}${baseQuestion.slice(1)}`;
          }
        }
        return baseQuestion;
      }
    }

    return null;
  }
}

export const interviewQuestionProvider: InterviewQuestionProvider =
  new DeterministicQuestionProvider();
