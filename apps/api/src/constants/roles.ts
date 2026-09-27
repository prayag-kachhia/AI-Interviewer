// Slice A (Live Session) — interview role catalogue.
//
// This is intentionally a small hard-coded list for Sprint 1. The frontend
// role picker (frontend/src/pages/NewInterview.tsx) shows the SAME ids, so
// keep the two lists in sync if you add a role here.

export interface InterviewRole {
  id: string;
  label: string;
}

export const INTERVIEW_ROLES: InterviewRole[] = [
  { id: 'software-engineer', label: 'Software Engineer' },
  { id: 'data-analyst', label: 'Data Analyst' },
  { id: 'backend-developer', label: 'Backend Developer' },
];

const VALID_ROLE_IDS = new Set(INTERVIEW_ROLES.map((r) => r.id));

export function isValidRoleId(roleId: string): boolean {
  return typeof roleId === 'string' && VALID_ROLE_IDS.has(roleId);
}
