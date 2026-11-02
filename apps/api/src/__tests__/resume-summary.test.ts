import { describe, it, expect } from 'vitest';
import { summarizeProfile } from '../services/resume-summary';

describe('summarizeProfile (FR-08, FR-09)', () => {
  const completeProfileFixture = {
    name: 'Rahul Patel',
    email: 'rahul@example.com',
    phone: '9876543210',
    summary: 'Software developer with expertise in scalable systems',
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Python', 'Kubernetes'],
    projects: [
      'AI Interviewer: Built an AI-powered mock interview platform with real-time voice feedback',
      'Security Platform: Developed an automated threat detection and alert system',
      'Library System: Built a local library management catalog application',
    ],
    experience: ['Software Engineering Intern at ABC Technologies (6 months)'],
    education: ['B.Tech in Information Technology from Gujarat Technological University (2024)'],
    certifications: ['AWS Certified Solutions Architect'],
    achievements: ['Won 1st place in National Hackathon 2023'],
    languages: ['English', 'Gujarati', 'Hindi'],
  };

  it('1. Complete profile with name, skills, two projects, and degree/role generates 3–5 line summary', () => {
    const result = summarizeProfile(completeProfileFixture);
    const lines = result.split('\n');

    expect(lines.length).toBe(5);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);

    expect(lines[0]).toBe('Name: Rahul Patel');
    expect(lines[1]).toContain('Strongest skills: TypeScript, React, Node.js, PostgreSQL, Docker, Python');
    expect(lines[2]).toBe('Project 1: AI Interviewer: Built an AI-powered mock interview platform with real-time voice feedback');
    expect(lines[3]).toBe('Project 2: Security Platform: Developed an automated threat detection and alert system');
    expect(lines[4]).toBe('Current role/experience: Software Engineering Intern at ABC Technologies (6 months)');

    // Crucial: 3rd project must NOT be included
    expect(result).not.toContain('Library System');
  });

  it('2. Handles missing skills safely without generating fake skills', () => {
    const profileNoSkills = {
      ...completeProfileFixture,
      skills: [],
    };

    const result = summarizeProfile(profileNoSkills);
    const lines = result.split('\n');

    expect(lines.length).toBe(4);
    expect(result).not.toContain('Strongest skills');
    expect(result).toContain('Rahul Patel');
    expect(result).toContain('AI Interviewer');
    expect(result).toContain('Security Platform');
    expect(result).toContain('Software Engineering Intern');
  });

  it('3. Handles missing projects safely without crashing or fabricating projects', () => {
    const profileNoProjects = {
      ...completeProfileFixture,
      projects: [],
    };

    const result = summarizeProfile(profileNoProjects);
    const lines = result.split('\n');

    expect(lines.length).toBe(3);
    expect(result).not.toContain('Project');
    expect(result).toContain('Rahul Patel');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Software Engineering Intern');
  });

  it('4. Returns empty string for empty profile object', () => {
    expect(summarizeProfile({})).toBe('');
  });

  it('5. Safely handles null, undefined, and non-object inputs', () => {
    expect(summarizeProfile(null)).toBe('');
    expect(summarizeProfile(undefined)).toBe('');
    expect(summarizeProfile('')).toBe('');
    expect(summarizeProfile(123)).toBe('');
    expect(summarizeProfile(true)).toBe('');
  });

  it('5b. Safely handles null or undefined optional fields within profile object', () => {
    const profileNullFields = {
      name: null,
      skills: null,
      projects: null,
      experience: null,
      education: null,
    };

    expect(summarizeProfile(profileNullFields)).toBe('');

    const profilePartialNulls = {
      name: 'Vishwa Trivedi',
      skills: null,
      projects: undefined,
      experience: null,
      education: ['B.E. in Computer Engineering'],
    };

    const result = summarizeProfile(profilePartialNulls);
    const lines = result.split('\n');

    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('Name: Vishwa Trivedi');
    expect(lines[1]).toBe('Degree: B.E. in Computer Engineering');
  });

  it('6. Correct 3–5 line output constraint is strictly satisfied for valid profiles', () => {
    const result = summarizeProfile(completeProfileFixture);
    const lines = result.split('\n');

    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('7. Does not fabricate any information when fields are missing', () => {
    const minimalProfile = {
      name: 'Aarav Shah',
    };

    const result = summarizeProfile(minimalProfile);
    expect(result).toBe('Name: Aarav Shah');
    expect(result).not.toContain('skills');
    expect(result).not.toContain('Project');
    expect(result).not.toContain('role');
    expect(result).not.toContain('Degree');
  });

  it('8. Uses Degree when candidate has no experience listed', () => {
    const studentProfile = {
      name: 'Priya Sharma',
      skills: ['Python', 'SQL'],
      projects: ['Data Dashboard: Visualized financial metrics using Streamlit'],
      experience: [],
      education: ['M.S. in Data Science, Stanford University'],
    };

    const result = summarizeProfile(studentProfile);
    const lines = result.split('\n');

    expect(lines.length).toBe(4);
    expect(result).toContain('Degree: M.S. in Data Science, Stanford University');
    expect(result).not.toContain('Current role');
  });

  it('9. Correctly parses stringified JSON profile', () => {
    const jsonString = JSON.stringify(completeProfileFixture);
    const result = summarizeProfile(jsonString);

    expect(result).toContain('Name: Rahul Patel');
    expect(result).toContain('Strongest skills');
    expect(result.split('\n').length).toBe(5);
  });

  it('10. Handles structured object representation of projects and experience', () => {
    const objectProfile = {
      name: 'Kishan Savani',
      skills: [{ name: 'Go' }, { name: 'Rust' }, { name: 'Kafka' }],
      projects: [
        { title: 'Stream Broker', description: 'Distributed messaging engine' },
        { name: 'Cache Layer', desc: 'In-memory KV store' },
      ],
      experience: [
        { role: 'Backend Architect', company: 'Global Cloud Systems' },
      ],
    };

    const result = summarizeProfile(objectProfile);
    const lines = result.split('\n');

    expect(lines.length).toBe(5);
    expect(lines[0]).toBe('Name: Kishan Savani');
    expect(lines[1]).toBe('Strongest skills: Go, Rust, Kafka');
    expect(lines[2]).toBe('Project 1: Stream Broker: Distributed messaging engine');
    expect(lines[3]).toBe('Project 2: Cache Layer: In-memory KV store');
    expect(lines[4]).toBe('Current role/experience: Backend Architect at Global Cloud Systems');
  });
});
