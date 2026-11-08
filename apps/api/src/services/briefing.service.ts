import { ROLES } from '@interview/contracts';
import prisma from '../utils/db';
import { summarizeProfile } from './resume-summary';

export interface BriefingInput {
  roleId: string;
  focus?: string;
  company?: string;
  level?: string;
  resumeSummary?: string;
  pastQuestions?: string[];
  timeLimitMin?: number;
}

export interface SessionLike {
  id?: string;
  role: string;
  userId?: string;
  resumeId?: string | null;
  focus?: string | null;
  company?: string | null;
  level?: string | null;
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

export interface RoleProgression {
  deepDiveTopics: string;
  pressureTestTopics: string;
}

export const ROLE_PROGRESSION: Record<string, RoleProgression> = {
  'software-engineer': {
    deepDiveTopics:
      'data structures, memory management vs CPU efficiency, async I/O, clean API design, and caching layers',
    pressureTestTopics:
      'sudden 10x traffic spikes, race conditions in multi-threaded workflows, degraded external dependencies, and memory leaks',
  },
  'data-analyst': {
    deepDiveTopics:
      'SQL query optimization, indexing strategies, handling skewed data distributions, metric drift, and ETL schema normalization vs denormalization',
    pressureTestTopics:
      'missing or corrupt data at scale, conflicting metrics from upstream pipelines, and reconciling anomalies during executive reporting',
  },
  'backend-developer': {
    deepDiveTopics:
      'database indexing (B-Tree vs Hash), connection pooling, distributed caching (Redis/Memcached), REST vs gRPC, idempotent endpoints, and transaction isolation levels',
    pressureTestTopics:
      'network partitions, split-brain scenarios, cascading microservice timeouts, poison-pill queue messages, and primary database failover under load',
  },
};

export interface PhaseTiming {
  warmUpMin: number;
  deepDiveMin: number;
  pressureTestMin: number;
}

/**
 * Calculates the time allocation across the three interview phases (K-4, DR-01, FR-17).
 * Phase 1 (Warm-up): ~20%
 * Phase 2 (Deep-dive): ~55%
 * Phase 3 (Pressure-test): ~25%
 */
export function calculatePhaseTiming(totalMin: number): PhaseTiming {
  const safeTotal = Math.max(5, totalMin);
  const warmUpMin = Math.max(2, Math.round(safeTotal * 0.2));
  const deepDiveMin = Math.max(2, Math.round(safeTotal * 0.55));
  const pressureTestMin = Math.max(1, safeTotal - warmUpMin - deepDiveMin);
  return { warmUpMin, deepDiveMin, pressureTestMin };
}

/**
 * Builds the server-side system instructions for the AI voice interviewer (FR-13, FR-15, FR-17, DR-01).
 * These instructions are locked into the ephemeral token minted for Gemini Live so the browser cannot
 * alter or view them (NFR-09).
 */
export function buildBriefing(input: BriefingInput): string {
  const { roleId, focus, company, level, resumeSummary, pastQuestions = [], timeLimitMin = 15 } = input;

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

  // 2. Focus area (if provided, FR-07)
  if (focus && focus.trim()) {
    sections.push(
      `PRIMARY FOCUS AREA:
The candidate has specified their focus: "${focus.trim()}".
Concentrate your technical evaluation and question scenarios primarily around this focus area.`
    );
  }

  // 3. Target Company / Organization (if provided, P-7)
  if (company && company.trim()) {
    sections.push(
      `TARGET COMPANY / ORGANIZATION:
The candidate is interviewing for a position at "${company.trim()}".
Tailor your questions, engineering culture expectations, and technical scenarios to the standards typical of ${company.trim()}.`
    );
  }

  // 4. Seniority Level (if provided, P-7)
  if (level && level.trim()) {
    sections.push(
      `TARGET SENIORITY LEVEL:
The position level is "${level.trim()}".
Calibrate the depth, complexity, and architectural expectations of your questions to a ${level.trim()}-level engineer.`
    );
  }

  // 5. Candidate Resume Context (if provided, FR-08)
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

  // 5. Structure & Timing — 3-Phase Question Progression (K-4, DR-01, FR-17)
  const { warmUpMin, deepDiveMin, pressureTestMin } = calculatePhaseTiming(timeLimitMin);
  const progression = ROLE_PROGRESSION[roleId] ?? {
    deepDiveTopics: 'core technical trade-offs, architecture patterns, and algorithmic performance',
    pressureTestTopics: 'production failure modes, edge-case bottlenecks, and incident debugging under scale',
  };

  sections.push(
    `INTERVIEW STRUCTURE & 3-PHASE QUESTION PROGRESSION (Total target duration: ${timeLimitMin} minutes):

1. Introduction (Start immediately):
   - Introduce yourself warmly as the AI Technical Interviewer.
   - Announce the role ("${roleInfo.label}"${focus ? ` - ${focus}` : ''}${company ? ` at ${company}` : ''}) and state that the interview will take about ${timeLimitMin} minutes.
   - Immediately ask your first technical or introductory question to begin Phase 1.

2. Core Technical Questions — 3-Phase Progression (Ask strictly ONE question at a time):
   You MUST guide the candidate sequentially through three distinct phases:

   • Phase 1: Warm-up & Architecture Overview (~${warmUpMin} minutes)
     - Ground questions in the candidate's resume projects, technologies, and system architecture. If no resume summary is present, ask about a notable system, web application, or project they have designed and implemented.
     - Evaluate how clearly the candidate articulates architectural decisions, system boundaries, component responsibilities, and technology trade-offs.

   • Phase 2: Technical Deep-Dive into Trade-offs (~${deepDiveMin} minutes)
     - Drive into rigorous technical depth tailored to the "${roleInfo.label}" role${focus ? ` and the focus area: "${focus}"` : ''}.
     - Actively evaluate key engineering trade-offs: focus on ${progression.deepDiveTopics}.
     - Listen carefully to the candidate's response. Ask a relevant, thoughtful follow-up question exploring their technical trade-offs, debugging approach, or architectural decisions before moving to a new topic.
     - Maintain appropriate technical depth for a campus placement / industry candidate.

   • Phase 3: Pressure-Testing & Edge-Case Failure Scenarios (~${pressureTestMin} minutes)
     - Challenge the candidate with real-world failure modes, scale limits, and edge cases: focus on ${progression.pressureTestTopics}.
     - Evaluate their debugging methodology, fault-tolerance design, graceful degradation, and composure under difficult failure scenarios (e.g., "What happens if this component fails under peak traffic?", "How would you trace an intermittent data corruption or timeout?").

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

/**
 * Loads role, resume summary (from VM-1's resumeId), focus, company, level,
 * past questions, and time limit for a given session, and builds the unified briefing (K-1, FR-17, DR-01).
 * Powers all interviewer paths: Gemini Live voice tokens, browser-speech fallback, and typed mode (PK-3).
 */
export async function briefingFor(session: SessionLike): Promise<string> {
  const roleId = session.role;
  const focus = session.focus?.trim() || undefined;
  const company = session.company?.trim() || undefined;
  const level = session.level?.trim() || undefined;
  const timeLimitMin = session.timeLimitMin ?? 15;

  let resumeParsedProfile: string | null = null;

  // 1. Look up resume by direct resumeId link (VM-1, FR-08, FR-09)
  if (session.resumeId && prisma.resume?.findUnique) {
    const resume = await prisma.resume.findUnique({
      where: { id: session.resumeId },
      select: { parsedProfile: true },
    });
    resumeParsedProfile = resume?.parsedProfile ?? null;
  }

  // 2. Fallback if session has no direct resumeId or not found (e.g. legacy sessions or test mocks)
  if (!resumeParsedProfile && session.userId && prisma.resume?.findFirst) {
    const fallbackResume = await prisma.resume.findFirst({
      where: { userId: session.userId },
      orderBy: { createdAt: 'desc' },
      select: { parsedProfile: true },
    });
    resumeParsedProfile = fallbackResume?.parsedProfile ?? null;
  }

  let resumeSummary: string | undefined;

  if (resumeParsedProfile) {
    try {
      const profile = JSON.parse(resumeParsedProfile);
      const summary = summarizeProfile(profile);
      resumeSummary = summary.trim() ? summary : undefined;
    } catch {
      // Fallback for raw text profiles (e.g. in test fixtures or legacy records)
      resumeSummary = resumeParsedProfile.trim() || undefined;
    }
  }

  // Past questions will be populated by PK-7; empty until then
  const pastQuestions: string[] = [];

  return buildBriefing({
    roleId,
    focus,
    company,
    level,
    resumeSummary,
    pastQuestions,
    timeLimitMin,
  });
}
