export type PasswordStrength = 'weak' | 'fair' | 'strong';

export interface PasswordRuleStatus {
  id: string;
  label: string;
  met: boolean;
}

export interface PasswordStrengthResult {
  score: number;
  strength: PasswordStrength;
  unmetRules: string[];
  rules: PasswordRuleStatus[];
}

export const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password123!',
  'password@123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'admin123',
  'admin1234',
  'admin@123',
  'administrator',
  'welcome1',
  'welcome12',
  'welcome123',
  'welcome123!',
  'welcome@123',
  'letmein123',
  'letmein123!',
  'iloveyou123',
  'pass1234',
  'changeme123',
  'test1234',
  'testing123',
  'testing@123',
  'abc12345',
  'secret123',
]);

/**
 * Extracts username tokens from an email address to check against the password.
 * Tokens with length < 3 are ignored to avoid false positives on short fragments.
 */
export function extractEmailTokens(email: string): string[] {
  if (!email || !email.includes('@')) return [];
  const username = email.split('@')[0].toLowerCase().trim();
  if (!username) return [];

  // Break by non-alphanumeric characters (dots, pluses, underscores, hyphens)
  const parts = username.split(/[^a-z0-9]+/i).filter((p) => p.length >= 3);
  const tokens = new Set<string>();

  // If the full username itself has length >= 3 and at least one part is >= 3
  if (username.length >= 3 && parts.length > 0) {
    tokens.add(username);
  }

  for (const part of parts) {
    tokens.add(part);
    // Also add alpha-only if numbers are present (e.g. "raj007" -> "raj")
    const alphaOnly = part.replace(/[0-9]/g, '');
    if (alphaOnly.length >= 3) {
      tokens.add(alphaOnly);
    }
  }

  return Array.from(tokens);
}

/**
 * Checks whether the password contains meaningful parts of the email username.
 */
export function containsEmailUsername(password: string, email: string): boolean {
  if (!email || !password) return false;
  const lowerPassword = password.toLowerCase();
  const tokens = extractEmailTokens(email);

  return tokens.some((token) => lowerPassword.includes(token));
}

/**
 * Pure, deterministic password strength evaluation engine.
 * Evaluates 7 required rules and returns strength, score, and unmet rule details.
 */
export function checkPasswordStrength(
  password: string,
  email = ''
): PasswordStrengthResult {
  const pwd = password || '';
  const emailTokens = extractEmailTokens(email);
  const lowerPwd = pwd.toLowerCase().trim();

  const isMinLength = pwd.length >= 8;
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasLowercase = /[a-z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(pwd);

  const hasEmailCollision =
    emailTokens.length > 0 &&
    emailTokens.some((token) => lowerPwd.includes(token));

  const isCommon = COMMON_PASSWORDS.has(lowerPwd);

  const rules: PasswordRuleStatus[] = [
    {
      id: 'min_length',
      label: 'At least 8 characters',
      met: isMinLength,
    },
    {
      id: 'uppercase',
      label: 'At least one uppercase letter (A-Z)',
      met: hasUppercase,
    },
    {
      id: 'lowercase',
      label: 'At least one lowercase letter (a-z)',
      met: hasLowercase,
    },
    {
      id: 'number',
      label: 'At least one number (0-9)',
      met: hasNumber,
    },
    {
      id: 'special_char',
      label: 'At least one special character (!@#$%^&*)',
      met: hasSpecialChar,
    },
    {
      id: 'no_email_part',
      label: 'Does not contain your name or email',
      met: !hasEmailCollision,
    },
    {
      id: 'not_common',
      label: 'Not a common weak password',
      met: !isCommon,
    },
  ];

  const score = rules.filter((r) => r.met).length;
  const unmetRules = rules.filter((r) => !r.met).map((r) => r.label);

  // Classification logic:
  // - Strong: all 7 rules satisfied
  // - Fair: at least 4 rules satisfied AND minimum length satisfied
  // - Weak: otherwise
  let strength: PasswordStrength = 'weak';
  if (score === 7) {
    strength = 'strong';
  } else if (score >= 4 && isMinLength) {
    strength = 'fair';
  }

  return {
    score,
    strength,
    unmetRules,
    rules,
  };
}
