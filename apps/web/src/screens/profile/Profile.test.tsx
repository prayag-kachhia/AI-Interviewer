import '@testing-library/jest-dom/vitest';
import { test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Profile } from './Profile';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getLatestResume: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'John Candidate', email: 'john@example.com' },
    deleteAccount: vi.fn(),
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockReset();
});

test('given no profile exists, displays "No Profile Found"', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({
    response: { status: 404 },
  });

  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  expect(await screen.findByText('No Profile Found')).toBeInTheDocument();
  expect(screen.getByText("You haven't uploaded a resume yet.")).toBeInTheDocument();
});

test('given resume analyzed with AI, shows "AI" badge and no warning alert', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-ai',
      fileName: 'candidate_cv.pdf',
      createdAt: '2026-03-01T12:00:00Z',
      source: 'ai',
      profile: {
        name: 'John Candidate',
        email: 'john@example.com',
        phone: '123-456-7890',
        summary: 'Experienced developer',
        education: ['B.S. CS'],
        skills: ['TypeScript', 'Node.js', 'React'],
        projects: ['AI Interviewer'],
        experience: ['Software Engineer at Tech'],
        certifications: [],
        achievements: [],
        languages: ['English'],
      },
    },
  });

  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  expect(await screen.findByText('John Candidate')).toBeInTheDocument();
  expect(screen.getByText('AI')).toBeInTheDocument();
  expect(screen.getByText(/Analysis: AI/i)).toBeInTheDocument();
  expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument();
});

test('given resume fell back to heuristic parser, shows "Basic parse" badge and warning alert', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-heur',
      fileName: 'fallback_cv.pdf',
      createdAt: '2026-03-01T12:00:00Z',
      source: 'heuristic',
      profile: {
        name: 'John Candidate',
        email: 'john@example.com',
        phone: '123-456-7890',
        summary: 'Heuristic summary',
        education: [],
        skills: ['Python', 'SQL'],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      },
    },
  });

  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  expect(await screen.findByText('John Candidate')).toBeInTheDocument();
  expect(screen.getByText('Basic parse')).toBeInTheDocument();
  expect(screen.getByText(/Analysis: Basic parser/i)).toBeInTheDocument();
  expect(screen.getByText('AI analysis unavailable')).toBeInTheDocument();
  expect(screen.getByText(/AI analysis was unavailable for your resume, so a basic heuristic parse was used/i)).toBeInTheDocument();
});

test('given legacy resume without source field, displays profile without false warning alert or source badge', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-legacy',
      fileName: 'legacy_cv.pdf',
      createdAt: '2026-03-01T12:00:00Z',
      profile: {
        name: 'John Candidate',
        email: 'john@example.com',
        phone: '123-456-7890',
        summary: 'Legacy summary',
        education: [],
        skills: ['Python'],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      },
    },
  });

  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  expect(await screen.findByText('John Candidate')).toBeInTheDocument();
  expect(screen.queryByText('AI')).not.toBeInTheDocument();
  expect(screen.queryByText('Basic parse')).not.toBeInTheDocument();
  expect(screen.queryByText(/Analysis:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument();
});
