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
