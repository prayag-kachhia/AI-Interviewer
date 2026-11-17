import '@testing-library/jest-dom/vitest';
import { test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Landing } from './Landing';

let auth: { user: { id: string } | null; loading: boolean };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );

test('signed-out visitor sees hero, three feature cards and CTA links to /login', () => {
  auth = { user: null, loading: false };
  renderLanding();
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Features' }).querySelectorAll('[data-slot="card"]')).toHaveLength(3);
  const ctas = screen.getAllByRole('link');
  expect(ctas.length).toBeGreaterThanOrEqual(1);
  ctas.forEach((a) => expect(a).toHaveAttribute('href', '/login'));
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
