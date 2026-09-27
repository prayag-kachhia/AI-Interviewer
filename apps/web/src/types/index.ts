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

export type SessionStatus = 'LIVE' | 'ENDED';
export type TurnSpeaker = 'AI' | 'CANDIDATE';

export type InterviewVoiceState =
  | 'IDLE'
  | 'AI_SPEAKING'
  | 'LISTENING'
  | 'CANDIDATE_SPEAKING'
  | 'PROCESSING'
  | 'ERROR';

export interface InterviewRoleOption {
  id: string;
  label: string;
  description?: string;
}

// Centralized role catalogue kept in sync with apps/api/src/constants/roles.ts
export const INTERVIEW_ROLES: InterviewRoleOption[] = [
  {
    id: 'software-engineer',
    label: 'Software Engineer',
    description: 'Full-stack architecture, system design, debugging, and engineering collaboration.',
  },
  {
    id: 'data-analyst',
    label: 'Data Analyst',
    description: 'SQL & data pipelines, exploratory analysis, metrics validation, and stakeholder insights.',
  },
  {
    id: 'backend-developer',
    label: 'Backend Developer',
    description: 'API design, database modeling, query optimization, and service reliability.',
  },
];

export interface TurnData {
  id: string;
  sessionId: string;
  speaker: TurnSpeaker;
  text: string;
  timestampSec: number;
  turnIndex: number;
  createdAt: string;
}

export interface SessionData {
  id: string;
  userId: string;
  role: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  createdAt?: string;
  turns?: TurnData[];
}

export interface RolesResponse {
  success: boolean;
  message?: string;
  data?: InterviewRoleOption[];
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
