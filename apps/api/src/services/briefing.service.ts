import { ROLES } from '@interview/contracts';

export interface BriefingInput {
  roleId: string;
  focus?: string;
  resumeSummary?: string;
  pastQuestions?: string[];
  timeLimitMin?: number;
}

const ROLE_PERSONAS: Record<string, { label: string; description: string }> = {
  'software-engineer': {
    label: 'Software Engineer',
    description:
      'You are an experienced Senior Software Engineering Interviewer. You evaluate clean architecture, data structures, algorithms, debugging, scalability, and engineering collaboration.',
  },
  'data-analyst': {
    label: 'Data Analyst',
    description:
      'You are a Lead Data Analyst and Interviewer. You evaluate SQL querying, data cleaning, statistical modeling, data visualization, metric validation, and translating data into actionable business insights.',
  },
  'backend-developer': {
    label: 'Backend Developer',
    description:
      'You are a Principal Backend Systems Architect and Interviewer. You evaluate server-side systems, REST and gRPC API design, database modeling, indexing, caching, fault tolerance, and high-concurrency reliability.',
  },
};

/**
 * Builds the server-side system instructions for the AI voice interviewer (FR-13, FR-15, FR-17, DR-01).
 * These instructions are locked into the ephemeral token minted for Gemini Live so the browser cannot
 * alter or view them (NFR-09).
 */
export function buildBriefing(input: BriefingInput): string {
  const { roleId, focus, resumeSummary, pastQuestions = [], timeLimitMin = 15 } = input;

  const roleInfo = ROLE_PERSONAS[roleId] ?? {
    label: ROLES.find((r) => r.id === roleId)?.label || roleId,
    description: `You are an expert technical interviewer evaluating candidates for the ${roleId} position.`,
  };

  const sections: string[] = [];

  // 1. Persona & Role
  sections.push(
    `ROLE & PERSONA:
You are conducting a professional mock technical interview for the position of "${roleInfo.label}".
${roleInfo.description}`
  );

  // 2. Focus area (if provided)
  if (focus && focus.trim()) {
    sections.push(
      `PRIMARY FOCUS AREA:
The candidate has specified their focus: "${focus.trim()}".
Concentrate your technical evaluation and question scenarios primarily around this focus area.`
    );
  }

  // 3. Candidate Resume Context (if provided, FR-08)
  if (resumeSummary && resumeSummary.trim()) {
    sections.push(
      `CANDIDATE RESUME SUMMARY:
${resumeSummary.trim()}

INSTRUCTION: You must tailor your technical questions to the candidate's background and explicitly refer to at least one specific project, technology, or experience mentioned in their resume.`
    );
  }

  // 4. Past Questions to avoid repeating (FR-16)
  if (pastQuestions.length > 0) {
    sections.push(
      `PREVIOUSLY ASKED QUESTIONS (DO NOT REPEAT):
${pastQuestions.map((q) => `- ${q}`).join('\n')}

INSTRUCTION: Never ask any of the questions listed above or close variations. All questions in this session must be novel.`
    );
  }

  // 5. Structure & Timing (DR-01, FR-17)
  sections.push(
    `INTERVIEW STRUCTURE & TIMING (Target duration: ${timeLimitMin} minutes):
1. Introduction (Start immediately):
   - Introduce yourself warmly as the AI Technical Interviewer.
   - Announce the role ("${roleInfo.label}"${focus ? ` - ${focus}` : ''}) and mention that the interview will take about ${timeLimitMin} minutes.
   - Immediately ask your first technical or introductory question to begin.
2. Core Technical Questions (3 to 4 questions total):
   - Ask strictly ONE question at a time. Never bundle multiple questions into a single turn.
   - Actively listen to the candidate's answer. Ask a relevant, thoughtful follow-up question exploring their technical trade-offs, debugging approach, or architectural decisions before moving to a new topic.
   - Maintain appropriate technical depth for a campus placement / industry candidate.
3. Wrap-up & Closing:
   - When approaching the ${timeLimitMin}-minute mark, inform the candidate that it is time to wrap up.
   - Give them an opportunity to ask any final questions or share parting thoughts.
   - Conclude with a warm, encouraging closing remark and thank them for their time.`
  );

  // 6. Conversational Audio Guidelines (Gemini Live)
  sections.push(
    `VOICE CONVERSATION GUIDELINES:
- Keep every spoken turn concise and natural (typically 1 to 3 spoken sentences per turn).
- DO NOT use markdown, bullet points, asterisks, or code blocks; your response is synthesized directly to speech.
- Speak naturally, professionally, and courteously.
- Never repeat a question you have already asked earlier in this interview.`
  );

  return sections.join('\n\n');
}
