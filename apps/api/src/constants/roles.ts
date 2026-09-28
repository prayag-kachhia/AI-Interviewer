import { ROLES } from '@interview/contracts';

// The role list lives in @interview/contracts so the API and the web app share it.
const VALID_ROLE_IDS = new Set(ROLES.map((r) => r.id));

export function isValidRoleId(roleId: string): boolean {
  return typeof roleId === 'string' && VALID_ROLE_IDS.has(roleId);
}
