export interface IdentityLike {
  id?: string;
  identity_id?: string;
  provider?: string;
  identity_data?: Record<string, any>;
  [key: string]: any;
}

/**
 * Extracts and verifies the GitHub username strictly from a linked GitHub identity.
 * Never derives from display name (e.g. `name` / `full_name`), email, or unverified claims.
 * Supabase Auth maps GitHub login to `user_name` or `preferred_username` inside `identity_data`.
 */
export function extractGitHubUsername(identity: IdentityLike | null | undefined): string | null {
  if (!identity || typeof identity !== 'object') return null;
  if (identity.provider !== 'github') return null;

  const data = identity.identity_data;
  if (!data || typeof data !== 'object') return null;

  // GitHub OAuth claims: `user_name` (Supabase default), `preferred_username` (OIDC standard), or `login` (raw GitHub)
  const candidate = data.user_name || data.preferred_username || data.login;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }

  return null;
}

/**
 * Finds the verified GitHub username from a list of user identities.
 * Returns null if no GitHub identity is linked or if username cannot be verified.
 */
export function getVerifiedGitHubUsername(identities: IdentityLike[] | null | undefined): string | null {
  if (!Array.isArray(identities)) return null;
  const ghIdentity = identities.find((id) => id && id.provider === 'github');
  return extractGitHubUsername(ghIdentity);
}

/**
 * Returns true if an identity with provider === 'github' is linked.
 */
export function hasGitHubIdentity(identities: IdentityLike[] | null | undefined): boolean {
  if (!Array.isArray(identities)) return false;
  return identities.some((id) => id && id.provider === 'github');
}

/**
 * Returns true if an identity with provider === 'google' is linked.
 */
export function hasGoogleIdentity(identities: IdentityLike[] | null | undefined): boolean {
  if (!Array.isArray(identities)) return false;
  return identities.some((id) => id && id.provider === 'google');
}

/**
 * Parses error messages from OAuth redirect URL query string or hash fragment.
 */
export function getOAuthErrorFromUrl(search: string, hash: string): string {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.substring(1) : '');
  const description = query.get('error_description') || fragment.get('error_description');
  const code = query.get('error') || fragment.get('error');

  if (description) {
    return description;
  }
  if (code) {
    return `Authentication error: ${code}`;
  }
  return '';
}
