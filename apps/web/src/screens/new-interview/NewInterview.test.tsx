import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ROLES } from '@interview/contracts';
import { NewInterview } from './NewInterview';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  createSession: vi.fn(),
  getRoles: vi.fn(),
  getLatestResume: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getRoles).mockResolvedValue({ success: true, data: ROLES } as never);
  vi.mocked(api.getLatestResume).mockResolvedValue({ success: true, data: { fileName: 'resume-prayag.pdf' } } as never);
});

function renderSetup(url = '/new-interview') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/new-interview" element={<NewInterview />} />
        <Route path="/interview/:id" element={<p>Interview room</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const start = () => screen.getByRole('button', { name: /start interview/i });

test('needs a role before it can start, then offers that role\'s focuses', () => {
  renderSetup();
  expect(start()).toBeDisabled();
  expect(screen.queryByRole('group', { name: /focus/i })).toBeNull();

  fireEvent.click(screen.getByRole('radio', { name: 'Data Analyst' }));

  expect(start()).toBeEnabled();
  for (const focus of ROLES[1].focuses) expect(screen.getByRole('button', { name: focus })).toBeInTheDocument();
});

test('picks a role by clicking anywhere on its card', () => {
  renderSetup();
  fireEvent.click(screen.getByText('SQL & data pipelines, exploratory analysis, metrics validation, and stakeholder insights.'));
  expect(screen.getByRole('radio', { name: 'Data Analyst' })).toBeChecked();
});

test('sends the whole setup and opens the interview room', async () => {
  vi.mocked(api.createSession).mockResolvedValue({ success: true, data: { id: 's-1' } } as never);
  renderSetup();

  fireEvent.click(screen.getByRole('radio', { name: 'Software Engineer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Debugging' }));
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: '  Atlassian ' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Mid' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Typed' }));
  fireEvent.click(start());

  expect(await screen.findByText('Interview room')).toBeInTheDocument();
  expect(api.createSession).toHaveBeenCalledWith({
    roleId: 'software-engineer',
    focus: 'Debugging',
    company: 'Atlassian',
    level: 'mid',
    mode: 'typed',
  });
});

test('leaves optional fields out and defaults to voice', async () => {
  vi.mocked(api.createSession).mockResolvedValue({ success: true, data: { id: 's-2' } } as never);
  renderSetup();

  fireEvent.click(screen.getByRole('radio', { name: 'Backend Developer' }));
  fireEvent.click(start());

  await screen.findByText('Interview room');
  expect(api.createSession).toHaveBeenCalledWith({
    roleId: 'backend-developer',
    focus: undefined,
    company: undefined,
    level: undefined,
    mode: 'voice',
  });
});

test('clears the focus when the role changes, and a second click unselects a focus', () => {
  renderSetup();
  fireEvent.click(screen.getByRole('radio', { name: 'Software Engineer' }));
  const debugging = screen.getByRole('button', { name: 'Debugging' });

  fireEvent.click(debugging);
  expect(debugging).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(debugging);
  expect(debugging).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(debugging);
  fireEvent.click(screen.getByRole('radio', { name: 'Data Analyst' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Software Engineer' }));
  expect(screen.getByRole('button', { name: 'Debugging' })).toHaveAttribute('aria-pressed', 'false');
});

test('pre-fills role and focus from the link, ignoring a focus the role does not have', () => {
  renderSetup('/new-interview?role=data-analyst&focus=SQL');
  expect(screen.getByRole('radio', { name: 'Data Analyst' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'SQL' })).toHaveAttribute('aria-pressed', 'true');
});

test('ignores an unknown focus in the link', () => {
  renderSetup('/new-interview?role=data-analyst&focus=Cooking');
  expect(screen.getByRole('radio', { name: 'Data Analyst' })).toBeChecked();
  for (const focus of ROLES[1].focuses) {
    expect(screen.getByRole('button', { name: focus })).toHaveAttribute('aria-pressed', 'false');
  }
});

test('shows the resume on file, or a link to upload one', async () => {
  renderSetup();
  expect(await screen.findByText('resume-prayag.pdf')).toBeInTheDocument();
  expect(screen.getByText('On file')).toBeInTheDocument();
});

test('offers an upload link when there is no resume', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValue({ response: { status: 404 } });
  renderSetup();
  const link = await screen.findByRole('link', { name: 'Upload one' });
  expect(link).toHaveAttribute('href', '/dashboard');
});

test('shows the API error and lets the candidate try again', async () => {
  vi.mocked(api.createSession).mockRejectedValue({ response: { data: { message: 'Session limit reached.' } } });
  renderSetup();
  fireEvent.click(screen.getByRole('radio', { name: 'Software Engineer' }));
  fireEvent.click(start());

  expect(await screen.findByRole('alert')).toHaveTextContent('Session limit reached.');
  await waitFor(() => expect(start()).toBeEnabled());
});

test('sends a pasted target job description with the session (PK-9, FR-11)', async () => {
  vi.mocked(api.createSession).mockResolvedValue({ success: true, data: { id: 's1' } } as never);
  renderSetup();
  fireEvent.click(screen.getByRole('radio', { name: 'Software Engineer' }));

  const posting = 'Looking for a Senior Backend Engineer to build high-throughput systems.';
  fireEvent.change(screen.getByRole('textbox', { name: /target job description/i }), { target: { value: posting } });
  expect(screen.getByText(/71\/4,000 characters/i)).toBeInTheDocument();

  fireEvent.click(start());

  await waitFor(() =>
    expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'software-engineer', jobContext: posting })),
  );
});

test('has no accessibility violations in initial setup state', async () => {
  const { container } = renderSetup();
  await screen.findByRole('radio', { name: 'Software Engineer' });
  expect(await axe(container)).toHaveNoViolations();
});

test('has no accessibility violations in configured interview state', async () => {
  const { container } = renderSetup();
  fireEvent.click(await screen.findByRole('radio', { name: 'Software Engineer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Debugging' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Senior' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Typed' }));

  expect(await axe(container)).toHaveNoViolations();
});
