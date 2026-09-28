import { TurnSpeaker } from '@prisma/client';

export interface TranscriptTurnInput {
  speaker: TurnSpeaker | 'AI' | 'CANDIDATE';
  text: string;
}

/**
 * Clean interface for interview question generation.
 *
 * TEAM BOUNDARY NOTE:
 * - This interface represents the INTERVIEWER question generator (distinct from
 *   the FB4 Feedback Evaluator LLM, which evaluates completed transcripts after
 *   `session.ended`).
 * - Because a live Interviewer LLM is a separate dependency outside LS2/LS4,
 *   `DeterministicQuestionProvider` below provides a deterministic stub for
 *   local development and Sprint 1 verification.
 */
export interface InterviewQuestionProvider {
  getInitialQuestion(role: string): string;
  getNextQuestion(role: string, transcript: TranscriptTurnInput[]): string | null;
}

const ROLE_QUESTION_SCRIPTS: Record<string, string[]> = {
  'software-engineer': [
    'Tell me about yourself and what excites you about software engineering.',
    'Can you walk me through a software project you are proud of and explain your specific role?',
    'How do you approach diagnosing and fixing a performance bottleneck in a web application?',
    'Tell me about a time you faced a tricky bug or technical disagreement on a team. How did you resolve it?',
    'Do you have any questions for me about the role or engineering culture before we wrap up?',
  ],
  'data-analyst': [
    'Tell me about yourself and what draws you to data analysis.',
    'Can you describe a project where you transformed raw or messy data into an actionable insight?',
    'How do you validate data quality and choose the right visualization for non-technical stakeholders?',
    'Tell me about a time you discovered an unexpected anomaly or error in your analysis. What steps did you take?',
    'Do you have any questions for me before we conclude the interview?',
  ],
  'backend-developer': [
    'Tell me about yourself and your experience building backend systems and APIs.',
    'Can you walk me through a backend service or database schema you designed and explain your architecture choices?',
    'How do you approach debugging a slow database query or high-latency API endpoint in production?',
    'Tell me about how you handle authentication, data integrity, and error recovery in distributed services.',
    'Do you have any questions for me before we wrap up today?',
  ],
};

const DEFAULT_SCRIPT = ROLE_QUESTION_SCRIPTS['software-engineer'];

/**
 * Extracts a short topic phrase from the candidate's latest answer so the
 * deterministic follow-up clearly demonstrates passing the preceding candidate
 * answer into `getNextQuestion(role, transcript)`.
 */
function extractCandidateHighlight(answerText: string): string | null {
  const cleaned = answerText.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  // Look for common technical or academic phrases mentioned by the candidate
  const clauses = cleaned
    .split(/[.!?;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  const targetClause = clauses[0] ?? cleaned;
  const words = targetClause.split(' ');
  if (words.length <= 8) {
    return targetClause.replace(/^(i am|i'm|i have|i've|my|we)\s+/i, '');
  }
  return words.slice(0, 8).join(' ').replace(/[ lists,:-]+$/, '') + '...';
}

export class DeterministicQuestionProvider implements InterviewQuestionProvider {
  getInitialQuestion(role: string): string {
    const script = ROLE_QUESTION_SCRIPTS[role] ?? DEFAULT_SCRIPT;
    return script[0];
  }

  getNextQuestion(role: string, transcript: TranscriptTurnInput[]): string | null {
    const script = ROLE_QUESTION_SCRIPTS[role] ?? DEFAULT_SCRIPT;

    const askedAiTexts = new Set(
      transcript
        .filter((t) => t.speaker === 'AI')
        .map((t) => t.text.trim().toLowerCase())
    );

    const candidateTurns = transcript.filter((t) => t.speaker === 'CANDIDATE');
    const lastCandidateTurn = candidateTurns[candidateTurns.length - 1];

    // Find the first question in the role script that hasn't been asked yet
    for (let idx = 0; idx < script.length; idx++) {
      const baseQuestion = script[idx];
      const alreadyAsked = Array.from(askedAiTexts).some(
        (asked) => asked === baseQuestion.toLowerCase() || asked.endsWith(baseQuestion.toLowerCase())
      );

      if (!alreadyAsked) {
        // For the first follow-up after the candidate's opening response,
        // reference the immediately preceding candidate answer deterministically.
        if (idx === 1 && lastCandidateTurn?.text) {
          const highlight = extractCandidateHighlight(lastCandidateTurn.text);
          if (highlight) {
            return `Thanks for sharing that context about "${highlight}". ${baseQuestion}`;
          }
        }
        return baseQuestion;
      }
    }

    return null;
  }
}

export const defaultQuestionProvider: InterviewQuestionProvider =
  new DeterministicQuestionProvider();
