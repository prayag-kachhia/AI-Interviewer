import '@testing-library/jest-dom/vitest';
import { test, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NewInterview } from './NewInterview';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  createSession: vi.fn(),
  getRoles: vi.fn().mockResolvedValue({
    success: true,
    data: [
      { id: 'software-engineer', label: 'Software Engineer', description: 'Coding & Architecture' },
    ],
  }),
  getLatestResume: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

test('given candidate has an uploaded resume, displays "Using resume: [Resume Name]" and link to profile', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-1',
      fileName: 'Rahul_Patel_Resume.pdf',
      createdAt: new Date().toISOString(),
      profile: {
        name: 'Rahul Patel',
        email: 'rahul@example.com',
        phone: '1234567890',
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
      <NewInterview />
    </MemoryRouter>
  );

  expect(await screen.findByText(/Using resume: Rahul_Patel_Resume\.pdf/i)).toBeInTheDocument();

  const profileLink = screen.getByRole('link', { name: /view profile/i });
  expect(profileLink).toBeInTheDocument();
  expect(profileLink).toHaveAttribute('href', '/profile');
});

test('given candidate has no uploaded resume, displays "No resume uploaded" and link to profile', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({
    response: { status: 404, data: { success: false, message: 'Resource not found' } },
  });

  render(
    <MemoryRouter>
      <NewInterview />
    </MemoryRouter>
  );

  expect(await screen.findByText(/No resume uploaded/i)).toBeInTheDocument();

  const profileLink = screen.getByRole('link', { name: /view profile/i });
  expect(profileLink).toBeInTheDocument();
  expect(profileLink).toHaveAttribute('href', '/profile');
});

test('allows candidate to paste a target job description and submits it at session creation (PK-9, FR-11)', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-1',
      fileName: 'Rahul_Resume.pdf',
      createdAt: new Date().toISOString(),
      profile: {
        name: 'Rahul Patel',
        email: 'rahul@example.com',
        phone: '1234567890',
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

  vi.mocked(api.createSession).mockResolvedValueOnce({
    success: true,
    data: {
      id: 'sess-new-1',
      userId: 'usr-1',
      role: 'software-engineer',
      status: 'LIVE',
      startedAt: new Date().toISOString(),
      endedAt: null,
      turns: [],
    },
  });

  render(
    <MemoryRouter>
      <NewInterview />
    </MemoryRouter>
  );

  const roleRadio = await screen.findByRole('radio', { name: /software engineer/i });
  fireEvent.click(roleRadio);

  const jobDescTextarea = screen.getByRole('textbox', { name: /target job description/i });
  expect(jobDescTextarea).toBeInTheDocument();
  fireEvent.change(jobDescTextarea, {
    target: { value: 'Looking for a Senior Backend Engineer to build high-throughput systems.' },
  });

  expect(screen.getByText(/71\/4,000 characters/i)).toBeInTheDocument();

  const startBtn = screen.getByRole('button', { name: /start interview/i });
  fireEvent.click(startBtn);

  expect(api.createSession).toHaveBeenCalledWith({
    roleId: 'software-engineer',
    jobContext: 'Looking for a Senior Backend Engineer to build high-throughput systems.',
  });
});

