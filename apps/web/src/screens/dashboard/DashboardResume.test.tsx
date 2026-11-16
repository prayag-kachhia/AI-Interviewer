import '@testing-library/jest-dom/vitest';
import { test, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Dashboard } from './Dashboard';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getLatestResume: vi.fn(),
  uploadResume: vi.fn(),
  getSessions: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Alex Smith', email: 'alex@example.com' },
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

test('given no resume on file, displays "Not uploaded" and no heuristic warning', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce(new Error('404 Not Found'));

  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('Not uploaded')).toBeInTheDocument();
  expect(screen.getByText('Awaiting Resume')).toBeInTheDocument();
  expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument();
});

test('given resume was parsed by AI, displays "AI" badge and "Analyzed with AI"', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-ai',
      fileName: 'alex_resume.pdf',
      createdAt: new Date().toISOString(),
      source: 'ai',
      profile: {
        name: 'Alex Smith',
        email: 'alex@example.com',
        phone: '',
        summary: '',
        education: [],
        skills: ['TypeScript', 'React'],
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
      <Dashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('On file')).toBeInTheDocument();
  expect(screen.getByText('AI')).toBeInTheDocument();
  expect(screen.getByText('Analyzed with AI')).toBeInTheDocument();
  expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument();
});

test('given resume fell back to heuristic parser, displays "Basic parse" badge and warning notice', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-heur',
      fileName: 'alex_resume.pdf',
      createdAt: new Date().toISOString(),
      source: 'heuristic',
      profile: {
        name: 'Alex Smith',
        email: 'alex@example.com',
        phone: '',
        summary: '',
        education: [],
        skills: ['TypeScript'],
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
      <Dashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('On file')).toBeInTheDocument();
  expect(screen.getByText('Basic parse')).toBeInTheDocument();
  expect(screen.getByText('Analyzed (Basic Parse)')).toBeInTheDocument();
  expect(screen.getByText('AI analysis unavailable')).toBeInTheDocument();
  expect(screen.getByText(/Your resume was parsed using our fallback parser/i)).toBeInTheDocument();
});

test('given legacy resume without source field, displays "On file" and "Analyzed & Ready" without warning alert or source badge', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-legacy',
      fileName: 'alex_resume.pdf',
      createdAt: new Date().toISOString(),
      profile: {
        name: 'Alex Smith',
        email: 'alex@example.com',
        phone: '',
        summary: '',
        education: [],
        skills: ['TypeScript'],
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
      <Dashboard />
    </MemoryRouter>
  );

  expect(await screen.findByText('On file')).toBeInTheDocument();
  expect(screen.getByText('Analyzed & Ready')).toBeInTheDocument();
  expect(screen.queryByText('AI')).not.toBeInTheDocument();
  expect(screen.queryByText('Basic parse')).not.toBeInTheDocument();
  expect(screen.queryByText(/AI analysis unavailable/i)).not.toBeInTheDocument();
});

test('handles upload directly without fake 1.5s timer and reflects heuristic fallback', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce(new Error('404 Not Found'));
  vi.mocked(api.uploadResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-new',
      fileName: 'resume.pdf',
      createdAt: new Date().toISOString(),
      source: 'heuristic',
      profile: {
        name: 'Alex Smith',
        email: '',
        phone: '',
        summary: '',
        education: [],
        skills: [],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      },
    },
  });

  const { container } = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

  const file = new File(['%PDF dummy'], 'resume.pdf', { type: 'application/pdf' });
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

  fireEvent.change(fileInput, { target: { files: [file] } });

  const analyzeButton = screen.getByRole('button', { name: /Analyze resume/i });
  fireEvent.click(analyzeButton);

  // Status should be set immediately without waiting 1.5s
  expect(screen.getByText('Analyzing resume...')).toBeInTheDocument();

  // Once resolved, shows completion notice
  await waitFor(() => {
    expect(screen.getByText('Analysis complete (basic parse)!')).toBeInTheDocument();
  });
});
