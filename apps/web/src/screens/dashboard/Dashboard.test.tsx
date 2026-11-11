import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Dashboard } from './Dashboard';
import { getSessions } from '../../lib/api';
import type { HistorySession } from '../../types';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Alex Johnson', email: 'alex@example.com' },
  }),
}));

vi.mock('../../lib/api', () => ({
  uploadResume: vi.fn(),
  getLatestResume: vi.fn().mockResolvedValue({ success: false }),
  getSessions: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Dashboard Achievements Section', () => {
  it('displays loading state while sessions are loading', () => {
    vi.mocked(getSessions).mockReturnValue(new Promise(() => { })); // Never resolves

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading achievements…')).toBeInTheDocument();
  });

  it('handles getSessions API failure gracefully without crashing', async () => {
    vi.mocked(getSessions).mockRejectedValue(new Error('Network error'));

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unable to load achievements at this time.');
    // Rest of dashboard remains intact
    expect(screen.getByText('Practice Interview')).toBeInTheDocument();
  });

  it('renders all four badges in locked state when session history is empty', async () => {
    vi.mocked(getSessions).mockResolvedValue({
      success: true,
      data: [],
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const section = await screen.findByTestId('achievements-section');
    expect(section).toBeInTheDocument();

    expect(screen.getByTestId('achievements-unlocked-count')).toHaveTextContent('0 of 4 Unlocked');
    expect(screen.getByTestId('achievement-badge-first-interview')).toHaveAttribute('data-unlocked', 'false');
    expect(screen.getByTestId('achievement-badge-five-interviews')).toHaveAttribute('data-unlocked', 'false');
    expect(screen.getByTestId('achievement-badge-improved-score')).toHaveAttribute('data-unlocked', 'false');
    expect(screen.getByTestId('achievement-badge-consistency-streak')).toHaveAttribute('data-unlocked', 'false');

    expect(screen.getByText('Complete your first mock interview to start unlocking badges!')).toBeInTheDocument();
  });

  it('renders unlocked badges when the candidate meets achievement criteria', async () => {
    const mockSessions: HistorySession[] = [
      {
        id: 's3',
        userId: 'u1',
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: '2026-11-03T10:00:00.000Z',
        endedAt: '2026-11-03T10:20:00.000Z',
        feedbackStatus: 'ready',
        overallScore: 4.5,
      },
      {
        id: 's2',
        userId: 'u1',
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: '2026-11-02T10:00:00.000Z',
        endedAt: '2026-11-02T10:20:00.000Z',
        feedbackStatus: 'ready',
        overallScore: 3.5,
      },
      {
        id: 's1',
        userId: 'u1',
        role: 'software-engineer',
        status: 'ENDED',
        startedAt: '2026-11-01T10:00:00.000Z',
        endedAt: '2026-11-01T10:20:00.000Z',
        feedbackStatus: 'ready',
        overallScore: 3.0,
      },
    ];

    vi.mocked(getSessions).mockResolvedValue({
      success: true,
      data: mockSessions,
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const section = await screen.findByTestId('achievements-section');
    expect(section).toBeInTheDocument();

    // With 3 completed sessions: First Interview unlocked, Improved Score unlocked (3.0 -> 3.5 -> 4.5), Consistency Streak unlocked (Nov 1, 2, 3), 5 Interviews locked
    expect(screen.getByTestId('achievements-unlocked-count')).toHaveTextContent('3 of 4 Unlocked');

    const firstBadge = screen.getByTestId('achievement-badge-first-interview');
    expect(firstBadge).toHaveAttribute('data-unlocked', 'true');
    expect(firstBadge).toHaveTextContent('First Interview');

    const fiveBadge = screen.getByTestId('achievement-badge-five-interviews');
    expect(fiveBadge).toHaveAttribute('data-unlocked', 'false');

    const improvedBadge = screen.getByTestId('achievement-badge-improved-score');
    expect(improvedBadge).toHaveAttribute('data-unlocked', 'true');

    const streakBadge = screen.getByTestId('achievement-badge-consistency-streak');
    expect(streakBadge).toHaveAttribute('data-unlocked', 'true');
  });

  it('unlocks 5 interviews badge when candidate completes at least 5 interviews', async () => {
    const fiveSessions: HistorySession[] = Array.from({ length: 5 }, (_, i) => ({
      id: `s-${i}`,
      userId: 'u1',
      role: 'software-engineer',
      status: 'ENDED',
      startedAt: `2026-11-0${i + 1}T10:00:00.000Z`,
      endedAt: `2026-11-0${i + 1}T10:20:00.000Z`,
      feedbackStatus: 'ready',
      overallScore: 3.0 + i * 0.2,
    }));

    vi.mocked(getSessions).mockResolvedValue({
      success: true,
      data: fiveSessions,
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    const fiveBadge = await screen.findByTestId('achievement-badge-five-interviews');
    expect(fiveBadge).toHaveAttribute('data-unlocked', 'true');
    expect(screen.getByTestId('achievements-unlocked-count')).toHaveTextContent('4 of 4 Unlocked');
  });
});
