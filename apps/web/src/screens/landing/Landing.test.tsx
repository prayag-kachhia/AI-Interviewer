import '@testing-library/jest-dom/vitest';
import { test, expect, vi } from 'vitest';
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

test('signed-out visitor sees the hero, and every link goes to /login except the in-page example link', () => {
  auth = { user: null, loading: false };
  renderLanding();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/practice interviews out loud/i);
  const links = screen.getAllByRole('link');
  expect(links.length).toBeGreaterThanOrEqual(3);
  for (const link of links) {
    const href = link.getAttribute('href');
    expect(href === '/login' || href === '#example-report', `unexpected link ${href}`).toBe(true);
  }
  expect(screen.getByRole('link', { name: 'See an example report' })).toHaveAttribute('href', '#example-report');
});

test('signed-in user is redirected to the dashboard', () => {
  auth = { user: { id: 'u1' }, loading: false };
  renderLanding();
  expect(screen.getByText('Dashboard page')).toBeInTheDocument();
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
