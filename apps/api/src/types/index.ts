export type { CandidateProfile } from '@interview/contracts';

export interface AuthUser {
  id: string;
  supabaseUserId?: string | null;
  email: string;
  name: string;
  role?: string;
  isEmailConfirmed?: boolean;
  githubUsername?: string | null;
}

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
