import '@testing-library/jest-dom/vitest';
import { axe } from 'vitest-axe';
import { test, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Profile } from './Profile';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getLatestResume: vi.fn(),
  exportMyData: vi.fn(),
}));

let mockAuthUser: any = {
  id: 'u1',
  name: 'John Candidate',
  email: 'john@example.com',
  identities: [],
};
const mockDeleteAccount = vi.fn();
const mockLinkGitHubIdentity = vi.fn().mockResolvedValue({ success: true, url: 'https://github.com/login/oauth/authorize' });
const mockRefreshIdentities = vi.fn().mockResolvedValue([]);

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthUser,
    deleteAccount: mockDeleteAccount,
    linkGitHubIdentity: mockLinkGitHubIdentity,
    refreshIdentities: mockRefreshIdentities,
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
  mockLinkGitHubIdentity.mockReset();
  mockRefreshIdentities.mockReset();
  mockAuthUser = {
    id: 'u1',
    name: 'John Candidate',
    email: 'john@example.com',
    identities: [],
  };
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

test('Delete Account button opens the confirmation dialog with permanent warning and user email', async () => {
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByRole('heading', { name: /Confirm Account Deletion/i })).toBeInTheDocument();
  expect(within(dialog).getByText(/This action is/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/irreversible/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/john@example\.com/)).toBeInTheDocument();
  expect(within(dialog).getByText(/All uploaded PDF resumes/i)).toBeInTheDocument();
});

test('dialog requires typing exact DELETE to enable deletion action', async () => {
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

  const deleteButton = await screen.findByRole('button', { name: /yes, delete everything/i });
  const input = screen.getByLabelText(/type DELETE to confirm account deletion/i);

  // Initially disabled
  expect(deleteButton).toBeDisabled();

  // Incorrect confirmation keeps deletion disabled
  fireEvent.change(input, { target: { value: 'delete' } });
  expect(deleteButton).toBeDisabled();

  fireEvent.change(input, { target: { value: 'DELET' } });
  expect(deleteButton).toBeDisabled();

  fireEvent.change(input, { target: { value: 'DELETE ' } });
  expect(deleteButton).toBeDisabled();

  // Exact DELETE enables deletion
  fireEvent.change(input, { target: { value: 'DELETE' } });
  expect(deleteButton).not.toBeDisabled();
});

test('Cancel button closes the dialog and resets confirmation input', async () => {
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

  const input = await screen.findByLabelText(/type DELETE to confirm account deletion/i);
  fireEvent.change(input, { target: { value: 'DELETE' } });

  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(mockDeleteAccount).not.toHaveBeenCalled();

  // Reopening starts fresh
  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  const reopenedInput = await screen.findByLabelText(/type DELETE to confirm account deletion/i);
  expect(reopenedInput).toHaveValue('');
  expect(screen.getByRole('button', { name: /yes, delete everything/i })).toBeDisabled();
});

test('successful deletion calls deleteAccount and navigates to /login with success message', async () => {
  mockDeleteAccount.mockResolvedValueOnce({ success: true, message: 'Account deleted' });
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));

  fireEvent.change(screen.getByLabelText(/type DELETE to confirm account deletion/i), {
    target: { value: 'DELETE' },
  });

  fireEvent.click(await screen.findByRole('button', { name: /yes, delete everything/i }));

  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: {
        message: 'Your account and all associated data have been permanently deleted.',
        mode: 'signin',
      },
    })
  );
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
});

test('failed deletion displays error, keeps user signed in, and does not navigate', async () => {
  mockDeleteAccount.mockResolvedValueOnce({ success: false, message: 'Database transaction rolled back' });
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  fireEvent.change(screen.getByLabelText(/type DELETE to confirm account deletion/i), {
    target: { value: 'DELETE' },
  });

  fireEvent.click(await screen.findByRole('button', { name: /yes, delete everything/i }));

  expect(await screen.findByText('Database transaction rolled back')).toBeInTheDocument();
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('loading state prevents duplicate deletion submissions while in progress', async () => {
  let resolvePromise: (value: { success: boolean }) => void = () => {};
  const pendingPromise = new Promise<{ success: boolean }>((resolve) => {
    resolvePromise = resolve;
  });

  mockDeleteAccount.mockReturnValueOnce(pendingPromise);
  await renderWithoutResume();

  fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
  fireEvent.change(screen.getByLabelText(/type DELETE to confirm account deletion/i), {
    target: { value: 'DELETE' },
  });

  const deleteBtn = await screen.findByRole('button', { name: /yes, delete everything/i });

  // First click triggers deleteAccount
  fireEvent.click(deleteBtn);
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);

  // Subsequent click while in flight is ignored
  fireEvent.click(deleteBtn);
  expect(mockDeleteAccount).toHaveBeenCalledTimes(1);

  // Resolve the deletion
  resolvePromise({ success: true });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', expect.anything()));
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
        achievements: ["Dean's List"],
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

test('existing user with no GitHub identity sees Connect GitHub button and Not connected status', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'John Candidate',
    email: 'john@example.com',
    identities: [{ provider: 'google', identity_data: { email: 'john@example.com' } }],
  };
  await renderWithoutResume();

  expect(screen.getByRole('button', { name: /connect github/i })).toBeInTheDocument();
  expect(screen.getByText(/Link your GitHub account to verify your developer identity/i)).toBeInTheDocument();
});

test('clicking Connect GitHub invokes linkIdentity via linkGitHubIdentity with provider github', async () => {
  await renderWithoutResume();

  const connectBtn = screen.getByRole('button', { name: /connect github/i });
  fireEvent.click(connectBtn);

  expect(mockLinkGitHubIdentity).toHaveBeenCalledTimes(1);
});

test('existing linked GitHub identity displays its verified username', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'John Candidate',
    email: 'john@example.com',
    identities: [
      {
        provider: 'github',
        identity_data: { user_name: 'vismay-solanki' },
      },
    ],
  };
  await renderWithoutResume();

  expect(screen.getByText('(@vismay-solanki)')).toBeInTheDocument();
  expect(screen.getByText('Connected as @vismay-solanki')).toBeInTheDocument();
});

test('GitHub username comes from identity data, never arbitrary user display name', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'Unverified Display Name',
    email: 'john@example.com',
    identities: [
      {
        provider: 'github',
        identity_data: {
          user_name: 'actual-github-handle',
          name: 'Unverified Display Name',
        },
      },
    ],
  };
  await renderWithoutResume();

  expect(screen.getByText('(@actual-github-handle)')).toBeInTheDocument();
  expect(screen.queryByText('(@Unverified Display Name)')).not.toBeInTheDocument();
});

test('a non-GitHub identity cannot be displayed as GitHub', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'Google Only Candidate',
    email: 'googleuser@example.com',
    identities: [
      {
        provider: 'google',
        identity_data: { user_name: 'google_user', email: 'googleuser@example.com' },
      },
    ],
  };
  await renderWithoutResume();

  expect(screen.getByRole('button', { name: /connect github/i })).toBeInTheDocument();
  expect(screen.queryByText('(@google_user)')).not.toBeInTheDocument();
});

test('missing GitHub username is handled safely without throwing', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'Candidate',
    email: 'user@example.com',
    identities: [
      {
        provider: 'github',
        identity_data: {},
      },
    ],
  };
  await renderWithoutResume();

  expect(screen.queryByRole('button', { name: /connect github/i })).not.toBeInTheDocument();
  expect(screen.getAllByText('Connected').length).toBeGreaterThanOrEqual(1);
});

test('already-connected GitHub account displays connected status instead of Connect button', async () => {
  mockAuthUser = {
    id: 'u1',
    name: 'Linked Candidate',
    email: 'linked@example.com',
    githubUsername: 'octocat',
    identities: [
      {
        provider: 'github',
        identity_data: { user_name: 'octocat' },
      },
    ],
  };
  await renderWithoutResume();

  expect(screen.queryByRole('button', { name: /connect github/i })).not.toBeInTheDocument();
  expect(screen.getByText('(@octocat)')).toBeInTheDocument();
});

test('linking errors are displayed correctly in an Alert', async () => {
  mockLinkGitHubIdentity.mockResolvedValueOnce({
    success: false,
    message: 'Identity is already linked to another user',
  });
  await renderWithoutResume();

  const connectBtn = screen.getByRole('button', { name: /connect github/i });
  fireEvent.click(connectBtn);

  expect(await screen.findByText('Identity is already linked to another user')).toBeInTheDocument();
});

test('duplicate submissions are prevented while linking is in progress', async () => {
  let resolvePromise: (val: any) => void = () => {};
  mockLinkGitHubIdentity.mockImplementationOnce(
    () => new Promise((resolve) => { resolvePromise = resolve; })
  );
  await renderWithoutResume();

  const connectBtn = screen.getByRole('button', { name: /connect github/i });

  fireEvent.click(connectBtn);
  expect(mockLinkGitHubIdentity).toHaveBeenCalledTimes(1);

  expect(connectBtn).toBeDisabled();

  fireEvent.click(connectBtn);
  expect(mockLinkGitHubIdentity).toHaveBeenCalledTimes(1);

  resolvePromise({ success: true });
});

test('existing user identity remains unchanged during linking', async () => {
  mockAuthUser = {
    id: 'user-keep-id',
    name: 'Original Candidate',
    email: 'original@example.com',
    identities: [],
  };
  await renderWithoutResume();

  const connectBtn = screen.getByRole('button', { name: /connect github/i });
  fireEvent.click(connectBtn);

  expect(mockAuthUser.id).toBe('user-keep-id');
  expect(mockAuthUser.email).toBe('original@example.com');
});

test('identity-refresh effect does not repeatedly execute when user state changes', async () => {
  const { rerender } = render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  await waitFor(() => {
    expect(mockRefreshIdentities).toHaveBeenCalledTimes(1);
  });

  // Simulate user state change in AuthContext
  mockAuthUser = {
    ...mockAuthUser,
    name: 'Updated Name',
    githubUsername: 'new-octocat',
  };

  rerender(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );

  expect(mockRefreshIdentities).toHaveBeenCalledTimes(1);
});
