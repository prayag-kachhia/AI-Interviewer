// The evaluation rubric for each interview role (FR-20, DR-03, DR-04). Changing one needs the lead's approval.

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

export function getRubric(roleId: string): Rubric {
  const rubric = RUBRICS_BY_ROLE[roleId];
  if (!rubric) throw new UnknownRoleError(roleId);
  return rubric;
}
