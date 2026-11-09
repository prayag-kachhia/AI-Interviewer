import type { CandidateProfile } from '../types';

export function summarizeProfile(p: CandidateProfile): string {
  const lines = [`Name: ${p.name}`];

  if (p.skills.length) {
    lines.push(`Strongest skills: ${p.skills.slice(0, 6).join(', ')}`);
  }

  p.projects.slice(0, 2).forEach((x, i) => {
    lines.push(`Project ${i + 1}: ${x}`);
  });

  const current = p.experience[0] ?? p.education[0];

  if (current) {
    lines.push(`Current role or degree: ${current}`);
  }

  return lines.join('\n');
}
