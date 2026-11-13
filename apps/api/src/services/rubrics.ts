// The evaluation rubric for each interview role (FR-20, DR-03, DR-04, DR-05). Changing one needs the lead's approval.

export interface RubricCategory {
  readonly category: string;
  readonly criteria: string;
}

export type Rubric = readonly RubricCategory[];

/**
 * Core principle for technology-independent scoring (PN-8, DR-05).
 * Any valid language, framework, library, or architectural approach earns full credit
 * when the underlying concept, correctness, and reasoning satisfy the criteria.
 */
export const TECHNOLOGY_INDEPENDENCE_PRINCIPLE =
  'Any valid technology, programming language, framework, library, or technical approach earns full credit when the underlying concept, correctness, and reasoning satisfy the criteria; evaluate the quality and depth of the solution rather than the specific choice of technology.';

/**
 * Core principle for separating technical depth from communication (S-5, FR-21, NFR-19).
 * Technical categories are judged strictly on content, correctness, and reasoning.
 * Pauses, fillers ("um", "uh", "like", "you know"), repetition, and hesitation affect
 * Communication only, never technical scores. Every comment must state why its score was given.
 */
export const SCORE_SEPARATION_PRINCIPLE =
  'Judge technical depth on content only; pauses, verbal fillers (such as "um", "uh", "like", "you know"), repetition, and hesitation affect Communication only, never technical scores. If the technical solution, algorithm, design, or reasoning is correct and sound, technical categories must receive high scores (4-5) regardless of hesitation or filler words. Every score comment must explicitly explain why its score was given.';

export class UnknownRoleError extends Error {
  constructor(roleId: string) {
    super(`Unsupported or unknown role: "${roleId}"`);
    this.name = 'UnknownRoleError';
  }
}

export const SOFTWARE_ENGINEER_RUBRIC: Rubric = [
  {
    category: 'Problem Solving & Algorithms',
    criteria:
      'Decomposes complex technical and system-level problems into tractable sub-problems; selects suitable algorithms, data structures, or service patterns; reasons about time and space complexity, throughput, and edge cases.',
  },
  {
    category: 'Software Design & Architecture',
    criteria:
      'Designs scalable systems and service components with clear separation of concerns; applies appropriate architectural patterns (e.g. queuing, caching, decoupling); articulates trade-offs between consistency, availability, and maintainability.',
  },
  {
    category: 'Technical Communication',
    criteria:
      'Explains technical decisions, trade-offs, and implementation details clearly and concisely; walks through reasoning in a structured, easy-to-follow way.',
  },
] as const;

export const DATA_ANALYST_RUBRIC: Rubric = [
  {
    category: 'SQL & Analytical Reasoning',
    criteria:
      'Formulates structured data extraction logic; leverages joins, aggregations, window functions, and filtering accurately; selects the right SQL construct for the problem.',
  },
  {
    category: 'Data Interpretation & Business Insights',
    criteria:
      'Extracts actionable conclusions from quantitative findings; decomposes metric changes into root causes; translates data insights into business impact and stakeholder recommendations.',
  },
  {
    category: 'Statistical Understanding & Data Quality',
    criteria:
      'Identifies data quality issues including duplicates, nulls, schema mismatches, and volume anomalies; validates pipeline outputs against expected invariants; demonstrates awareness of edge cases that affect analytical accuracy.',
  },
] as const;

export const BACKEND_DEVELOPER_RUBRIC: Rubric = [
  {
    category: 'API Design & Architecture',
    criteria:
      'Designs clean, idiomatic REST service endpoints; handles HTTP semantics, error codes, authentication, and backward compatibility robustly; documents contracts clearly.',
  },
  {
    category: 'Database Modeling & Performance',
    criteria:
      'Models relational schemas effectively; understands indexing strategies and query performance; designs idempotent and transactionally safe data access patterns that handle concurrent or repeated requests correctly.',
  },
  {
    category: 'System Reliability & Scalability',
    criteria:
      'Reasons about concurrency, asynchronous workflows, caching, failure recovery, and resilience under load; applies retry strategies, circuit breaking, and idempotency to prevent data corruption or cascading failures.',
  },
] as const;

const RUBRICS_BY_ROLE: Record<string, Rubric> = {
  'software-engineer': SOFTWARE_ENGINEER_RUBRIC,
  'data-analyst': DATA_ANALYST_RUBRIC,
  'backend-developer': BACKEND_DEVELOPER_RUBRIC,
};

export function getRubric(roleId: string): Rubric {
  const rubric = RUBRICS_BY_ROLE[roleId];
  if (!rubric) throw new UnknownRoleError(roleId);
  return rubric;
}
