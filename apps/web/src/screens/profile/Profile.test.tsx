import '@testing-library/jest-dom/vitest';
import { test, expect, vi, afterEach } from 'vitest';
import { axe } from 'vitest-axe';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Profile } from './Profile';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getLatestResume: vi.fn(),
  exportMyData: vi.fn(),
}));

const mockDeleteAccount = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'John Candidate', email: 'john@example.com' },
    deleteAccount: mockDeleteAccount,
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
  mockDeleteAccount.mockReset();
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

const renderWithoutResume = async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({ response: { status: 404 } });
  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );
  await screen.findByText('No Profile Found');
};

test('given the user confirms account deletion, deletes and goes to login', async () => {
  mockDeleteAccount.mockResolvedValueOnce({ success: true });
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  fireEvent.click(await screen.findByRole('button', { name: /yes, delete everything/i }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', expect.anything()));
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
});

test('given account deletion fails, keeps the dialog open and shows the error', async () => {
  mockDeleteAccount.mockResolvedValueOnce({ success: false, message: 'Server said no' });
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  fireEvent.click(await screen.findByRole('button', { name: /yes, delete everything/i }));

  expect(await screen.findByText('Server said no')).toBeInTheDocument();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('given the user cancels, nothing is deleted', async () => {
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));

  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(mockDeleteAccount).not.toHaveBeenCalled();
});

test('given data export fails, shows the error message', async () => {
  vi.mocked(api.exportMyData).mockRejectedValueOnce({ response: { data: { message: 'Export broke' } } });
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /download my data/i }));

  expect(await screen.findByText('Export broke')).toBeInTheDocument();
});

test('has no accessibility violations in populated profile state', async () => {
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
        phone: '+1 555 123 4567',
        summary: 'Experienced software engineer.',
        skills: ['TypeScript', 'React', 'Node.js'],
        education: ['B.S. in Computer Science'],
        experience: ['Software Engineer at Tech Corp'],
        projects: ['AI Interviewer'],
        certifications: ['AWS Certified Solutions Architect'],
        achievements: ['Dean\'s List'],
        languages: ['English', 'Spanish'],
      },
    },
  });

  const { container } = render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  await screen.findByText('John Candidate');
  expect(await axe(container)).toHaveNoViolations();
});

test('has no accessibility violations in empty profile state', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({ response: { status: 404 } });

  const { container } = render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  await screen.findByText('No Profile Found');
  expect(await axe(container)).toHaveNoViolations();
});

test('has no accessibility violations when delete dialog is open', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({ response: { status: 404 } });

  const { container } = render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  await screen.findByText('No Profile Found');
  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  await screen.findByRole('alertdialog');

  expect(await axe(container)).toHaveNoViolations();
});
