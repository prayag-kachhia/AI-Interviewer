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

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  data?: {
    token: string;
    user: User;
  };
}

export interface ResumeData {
  resumeId: string;
  fileName: string;
  createdAt: string;
  profile: CandidateProfile;
}

export interface ResumeResponse {
  success: boolean;
  message?: string;
  data?: ResumeData;
}

// ---------------------------------------------------------------------------
// Slice A — Live Session (LS2 + LS4)
// ---------------------------------------------------------------------------

export type { Role, SessionStatus, TurnSpeaker } from '@interview/contracts';
import type { Role, Session, Turn } from '@interview/contracts';

export type InterviewVoiceState =
  | 'IDLE'
  | 'AI_SPEAKING'
  | 'LISTENING'
  | 'CANDIDATE_SPEAKING'
  | 'PROCESSING'
  | 'ERROR';

export type TurnData = Turn;

export type SessionData = Session;

export interface RolesResponse {
  success: boolean;
  message?: string;
  data?: Role[];
}

export interface SessionResponse {
  success: boolean;
  message?: string;
  data?: SessionData;
}

export interface TurnResponse {
  success: boolean;
  message?: string;
  data?: TurnData;
}

export interface TurnsListResponse {
  success: boolean;
  message?: string;
  data?: TurnData[];
}
