/**
 * Resume Profile Summary Service (FR-08, FR-09)
 *
 * Generates a concise 3–5 line summary of candidate profile information
 * to inject into the AI interviewer voice briefing context.
 */

export function summarizeProfile(profile: unknown): string {
  if (!profile) {
    return '';
  }

  let data: any = profile;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return '';
    }
  }

  if (typeof data !== 'object' || data === null) {
    return '';
  }

  const lines: string[] = [];

  // 1. Candidate's name
  if (typeof data.name === 'string' && data.name.trim()) {
    lines.push(`Name: ${data.name.trim()}`);
  }

  // 2. Strongest skills
  let skillsList: string[] = [];
  if (Array.isArray(data.skills)) {
    skillsList = data.skills
      .map((s: any) =>
        typeof s === 'string'
          ? s.trim()
          : typeof s?.name === 'string'
            ? s.name.trim()
            : ''
      )
      .filter((s: string) => s.length > 0);
  } else if (typeof data.skills === 'string' && data.skills.trim()) {
    skillsList = data.skills
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
  }

  if (skillsList.length > 0) {
    lines.push(`Strongest skills: ${skillsList.slice(0, 6).join(', ')}`);
  }

  // 3 & 4. First and second projects with one-line descriptions
  if (Array.isArray(data.projects)) {
    const validProjects = data.projects
      .map((proj: any) => {
        if (typeof proj === 'string') {
          return proj.replace(/\r?\n+/g, ' ').trim();
        }
        if (proj && typeof proj === 'object') {
          const title = proj.title || proj.name || '';
          const desc = proj.description || proj.desc || proj.summary || '';
          if (title && desc) {
            return `${title}: ${desc}`.replace(/\r?\n+/g, ' ').trim();
          }
          if (title) return String(title).trim();
          if (desc) return String(desc).trim();
        }
        return '';
      })
      .filter((p: string) => p.length > 0);

    validProjects.slice(0, 2).forEach((project: string, index: number) => {
      lines.push(`Project ${index + 1}: ${project}`);
    });
  }

  // 5. Current role, professional position, or degree
  let roleOrPosition = '';

  if (typeof data.role === 'string' && data.role.trim()) {
    roleOrPosition = data.role.trim();
  } else if (typeof data.currentRole === 'string' && data.currentRole.trim()) {
    roleOrPosition = data.currentRole.trim();
  } else if (typeof data.position === 'string' && data.position.trim()) {
    roleOrPosition = data.position.trim();
  } else if (typeof data.title === 'string' && data.title.trim()) {
    roleOrPosition = data.title.trim();
  }

  if (!roleOrPosition && Array.isArray(data.experience) && data.experience.length > 0) {
    const firstExp = data.experience[0];
    if (typeof firstExp === 'string' && firstExp.trim()) {
      roleOrPosition = firstExp.replace(/\r?\n+/g, ' ').trim();
    } else if (firstExp && typeof firstExp === 'object') {
      const expRole = firstExp.role || firstExp.title || firstExp.position || '';
      const company = firstExp.company || firstExp.organization || '';
      if (expRole && company) {
        roleOrPosition = `${expRole} at ${company}`;
      } else if (expRole) {
        roleOrPosition = expRole;
      } else if (company) {
        roleOrPosition = company;
      }
    }
  }

  if (roleOrPosition) {
    lines.push(`Current role/experience: ${roleOrPosition}`);
  } else {
    let degree = '';
    if (typeof data.degree === 'string' && data.degree.trim()) {
      degree = data.degree.trim();
    } else if (Array.isArray(data.education) && data.education.length > 0) {
      const firstEdu = data.education[0];
      if (typeof firstEdu === 'string' && firstEdu.trim()) {
        degree = firstEdu.replace(/\r?\n+/g, ' ').trim();
      } else if (firstEdu && typeof firstEdu === 'object') {
        const d = firstEdu.degree || '';
        const school = firstEdu.institution || firstEdu.school || firstEdu.university || '';
        if (d && school) {
          degree = `${d}, ${school}`;
        } else if (d) {
          degree = d;
        } else if (school) {
          degree = school;
        }
      }
    }

    if (degree) {
      lines.push(`Degree: ${degree}`);
    }
  }

  return lines.join('\n');
}
