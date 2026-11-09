import { describe, it, expect } from 'vitest';
import { summarizeProfile } from '../services/resume-summary';
import type { CandidateProfile } from '../types';

describe('summarizeProfile', () => {
  const profile: CandidateProfile = {
    name: 'Rahul Patel',
    email: 'rahul@example.com',
    phone: '9876543210',
    summary: 'Software developer',
    skills: [
      'TypeScript',
      'React',
      'Node.js',
      'PostgreSQL',
      'Docker',
      'Python',
      'Kubernetes',
    ],
    projects: [
      'AI Interviewer',
      'Security Platform',
      'Library System',
    ],
    experience: ['Software Engineering Intern'],
    education: ['B.Tech in Information Technology'],
    certifications: [],
    achievements: [],
    languages: [],
  };

  it('summarizes name, skills, projects, and experience', () => {
    const result = summarizeProfile(profile);

    expect(result).toBe(
      [
        'Name: Rahul Patel',
        'Strongest skills: TypeScript, React, Node.js, PostgreSQL, Docker, Python',
        'Project 1: AI Interviewer',
        'Project 2: Security Platform',
        'Current role or degree: Software Engineering Intern',
      ].join('\n'),
    );

    expect(result).not.toContain('Library System');
  });

  it('omits skills when none are available', () => {
    const result = summarizeProfile({
      ...profile,
      skills: [],
    });

    expect(result).not.toContain('Strongest skills');
  });

  it('omits projects when none are available', () => {
    const result = summarizeProfile({
      ...profile,
      projects: [],
    });

    expect(result).not.toContain('Project');
  });

  it('uses education when experience is unavailable', () => {
    const result = summarizeProfile({
      ...profile,
      experience: [],
    });

    expect(result).toContain(
      'Current role or degree: B.Tech in Information Technology',
    );
  });

  it('returns only the name when optional summary fields are empty', () => {
    const result = summarizeProfile({
      ...profile,
      skills: [],
      projects: [],
      experience: [],
      education: [],
    });

    expect(result).toBe('Name: Rahul Patel');
  });
});
