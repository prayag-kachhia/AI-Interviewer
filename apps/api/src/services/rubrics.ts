// Per-role evaluation rubrics with distinct categories and criteria (Issue #93, FR-20, DR-03, DR-04).
import { ROLES } from '@interview/contracts';

export interface RubricCategory {
  readonly category: string;
  readonly criteria: string;
}

export type Rubric = readonly RubricCategory[];

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
      'Approaches complex technical problems methodically; selects suitable data structures; considers time and space complexity and edge cases.',
  },
  {
    category: 'Software Design & Architecture',
    criteria:
      'Structures code and components modularly; applies separation of concerns and appropriate patterns; balances maintainability with pragmatism.',
  },
  {
    category: 'Technical Communication',
    criteria:
      'Explains technical decisions, trade-offs, and implementation details clearly and concisely; walks through logic logically.',
  },
] as const;

export const DATA_ANALYST_RUBRIC: Rubric = [
  {
    category: 'SQL & Analytical Reasoning',
    criteria:
      'Formulates structured data extraction logic; leverages joins, aggregations, window functions, and filtering accurately.',
  },
  {
    category: 'Data Interpretation & Business Insights',
    criteria:
      'Extracts actionable conclusions from quantitative findings; translates metrics into business impact and stakeholder recommendations.',
  },
  {
    category: 'Statistical Understanding & Data Quality',
    criteria:
      'Demonstrates understanding of distributions, sampling, anomalies, and edge cases; proactively validates data integrity.',
  },
] as const;

export const BACKEND_DEVELOPER_RUBRIC: Rubric = [
  {
    category: 'API Design & Architecture',
    criteria:
      'Designs clean, idiomatic service endpoints and interfaces; handles error codes, payloads, and backward compatibility robustly.',
  },
  {
    category: 'Database Modeling & Performance',
    criteria:
      'Models relational or document schemas effectively; understands indexing strategies, query performance, and transactional consistency.',
  },
  {
    category: 'System Reliability & Scalability',
    criteria:
      'Reasons about concurrency, asynchronous workflows, idempotency, caching, failure recovery, and resilience under load.',
  },
] as const;

const RUBRICS_BY_ROLE: Record<string, Rubric> = {
  'software-engineer': SOFTWARE_ENGINEER_RUBRIC,
  'data-analyst': DATA_ANALYST_RUBRIC,
  'backend-developer': BACKEND_DEVELOPER_RUBRIC,
};

/**
 * Returns the role-specific rubric for evaluation.
 * Throws UnknownRoleError if the role ID is not recognized.
 */
export function getRubric(roleId: string): Rubric {
  if (!roleId || typeof roleId !== 'string') {
    throw new UnknownRoleError(String(roleId));
  }

  const normalized = roleId.trim().toLowerCase();

  // Match by exact role ID
  if (RUBRICS_BY_ROLE[normalized]) {
    return RUBRICS_BY_ROLE[normalized];
  }

  // Fallback match by role label (e.g., "Software Engineer" -> "software-engineer")
  const matchedRole = ROLES.find(
    (r) => r.id.toLowerCase() === normalized || r.label.toLowerCase() === normalized
  );
  if (matchedRole && RUBRICS_BY_ROLE[matchedRole.id]) {
    return RUBRICS_BY_ROLE[matchedRole.id];
  }

  throw new UnknownRoleError(roleId);
}