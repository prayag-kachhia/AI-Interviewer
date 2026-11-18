import '@testing-library/jest-dom/vitest';
import { test, expect, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ROLES } from '@interview/contracts';
import { Landing, SESSION_MINUTES } from './Landing';
import { DEFAULT_TIME_LIMIT_MIN } from '../interview-room/useInterview';

let auth: { user: { id: string } | null; loading: boolean };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
// useInterview (imported for its time-limit constant) pulls in the Supabase client, which needs a URL.
vi.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );

const hrefs = () => screen.getAllByRole('link').map((a) => a.getAttribute('href'));

test('signed-out visitor sees the landing page with sign-in and sign-up, and nothing that needs an account', () => {
  auth = { user: null, loading: false };
  renderLanding();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/practice interviews out loud/i);
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/login');
  expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/login');
  expect(screen.getByRole('link', { name: 'Start practising' })).toHaveAttribute('href', '/login');
  expect(screen.queryByRole('link', { name: 'Open dashboard' })).not.toBeInTheDocument();
  for (const href of hrefs()) {
    expect(['/', '/login', '#example-report'], `unexpected link ${href}`).toContain(href);
  }
});

test('signed-in user also sees the landing page, with the dashboard instead of sign-in', () => {
  auth = { user: { id: 'u1' }, loading: false };
  renderLanding();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/practice interviews out loud/i);
  expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument();
  for (const link of screen.getAllByRole('link', { name: 'Open dashboard' })) {
    expect(link).toHaveAttribute('href', '/dashboard');
  }
  expect(screen.getByRole('link', { name: 'Start an interview' })).toHaveAttribute('href', '/new-interview');
  expect(screen.queryByRole('link', { name: /sign in|sign up/i })).not.toBeInTheDocument();
});

test('the logo goes to the landing page', () => {
  auth = { user: null, loading: false };
  renderLanding();
  expect(screen.getByRole('link', { name: 'AI Interviewer home' })).toHaveAttribute('href', '/');
});

test('renders nothing while auth is loading', () => {
  auth = { user: null, loading: true };
  const { container } = renderLanding();
  expect(container).toBeEmptyDOMElement();
});

test('shows the three steps of the flow in order', () => {
  auth = { user: null, loading: false };
  renderLanding();
  const steps = within(screen.getByRole('region', { name: 'How it works' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
  expect(steps).toEqual([
    '01Upload your resume and choose a role',
    '02Answer the interviewer out loud',
    '03Read your feedback and follow the plan',
  ]);
});

test('lists the real roles and states the real session length', () => {
  auth = { user: null, loading: false };
  renderLanding();
  const roles = screen.getByRole('region', { name: 'What you can practise' });
  for (const role of ROLES) {
    expect(within(roles).getByText(role.label)).toBeInTheDocument();
  }
  expect(SESSION_MINUTES).toBe(DEFAULT_TIME_LIMIT_MIN);
  expect(screen.getByText(`${SESSION_MINUTES} min`)).toBeInTheDocument();
});

test('the sample report is clearly labelled as an example', () => {
  auth = { user: null, loading: false };
  renderLanding();
  const report = screen.getByRole('region', { name: 'What your feedback looks like' });
  expect(within(report).getByText('Example')).toBeInTheDocument();
  expect(within(report).getByText(/made up to show the format/i)).toBeInTheDocument();
});

test('has no accessibility violations (signed out and signed in)', async () => {
  auth = { user: null, loading: false };
  const signedOut = renderLanding();
  expect(await axe(signedOut.container)).toHaveNoViolations();
  signedOut.unmount();

  auth = { user: { id: 'u1' }, loading: false };
  const signedIn = renderLanding();
  expect(await axe(signedIn.container)).toHaveNoViolations();
});
