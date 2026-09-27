export interface CandidateProfile {
  name: string;
  email: string;
  phone: string;
  summary: string;
  education: string[];
  skills: string[];
  projects: string[];
  experience: string[];
  certifications: string[];
  achievements: string[];
  languages: string[];
}

export interface AuthUser {
  id: string;
  supabaseUserId?: string | null;
  email: string;
  name: string;
  role?: string;
}

// Extend Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
