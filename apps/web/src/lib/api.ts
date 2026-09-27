import axios from 'axios';
import { supabase } from './supabase';
import type {
  ResumeResponse,
  AuthResponse,
  RolesResponse,
  SessionResponse,
  TurnResponse,
  TurnsListResponse,
  TurnSpeaker,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use(async (config) => {
  // Check local token first
  const localToken = localStorage.getItem('auth_token');
  if (localToken) {
    config.headers.Authorization = `Bearer ${localToken}`;
    return config;
  }

  // Fallback to Supabase token if available
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    // Ignore error if Supabase credentials are dummy or unreachable
  }
  return config;
});

// Resume Endpoints
export const uploadResume = async (file: File): Promise<ResumeResponse> => {
  const formData = new FormData();
  formData.append('resume', file);

  const { data } = await api.post<ResumeResponse>('/resume/analyze', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const getLatestResume = async (): Promise<ResumeResponse> => {
  const { data } = await api.get<ResumeResponse>('/resume/latest');
  return data;
};

// Auth & User Endpoints
export const checkUserExists = async (email: string): Promise<{ success: boolean; exists: boolean; name?: string }> => {
  const { data } = await api.post('/auth/check-user', { email });
  return data;
};

export const registerUser = async (name: string, email: string, password: string): Promise<AuthResponse> => {
  const { data } = await api.post<AuthResponse>('/auth/register', { name, email, password });
  return data;
};

export const loginUser = async (email: string, password: string): Promise<AuthResponse> => {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
  return data;
};

export const logoutUser = async (): Promise<{ success: boolean; message: string }> => {
  const { data } = await api.post('/auth/logout');
  return data;
};

export const deleteUserAccount = async (): Promise<{ success: boolean; message: string; deletedResumesCount?: number }> => {
  const { data } = await api.delete('/auth/account');
  return data;
};

export const getMe = async (): Promise<{ success: boolean; data: any }> => {
  const { data } = await api.get('/auth/me');
  return data;
};

// ---------------------------------------------------------------------------
// Slice A — Live Session (LS2 + LS4) Endpoints
// ---------------------------------------------------------------------------

export const getRoles = async (): Promise<RolesResponse> => {
  const { data } = await api.get<RolesResponse>('/sessions/roles');
  return data;
};

export const createSession = async (roleId: string): Promise<SessionResponse> => {
  const { data } = await api.post<SessionResponse>('/sessions', { roleId });
  return data;
};

export const getSession = async (sessionId: string): Promise<SessionResponse> => {
  const { data } = await api.get<SessionResponse>(`/sessions/${sessionId}`);
  return data;
};

export const getTurns = async (sessionId: string): Promise<TurnsListResponse> => {
  const { data } = await api.get<TurnsListResponse>(`/sessions/${sessionId}/turns`);
  return data;
};

export const postTurn = async (
  sessionId: string,
  speaker: TurnSpeaker,
  text: string,
  timestampSec: number
): Promise<TurnResponse> => {
  const { data } = await api.post<TurnResponse>(`/sessions/${sessionId}/turns`, {
    speaker,
    text,
    timestampSec,
  });
  return data;
};

export const endSession = async (sessionId: string): Promise<SessionResponse> => {
  const { data } = await api.post<SessionResponse>(`/sessions/${sessionId}/end`);
  return data;
};

export const endInterviewSession = endSession;

export default api;
