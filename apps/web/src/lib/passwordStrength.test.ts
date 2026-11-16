import { describe, it, expect } from 'vitest';
import {
  checkPasswordStrength,
  extractEmailTokens,
  containsEmailUsername,
} from './passwordStrength';

describe('passwordStrength utility', () => {
  describe('extractEmailTokens', () => {
    it('returns empty array for invalid or empty email', () => {
      expect(extractEmailTokens('')).toEqual([]);
      expect(extractEmailTokens('invalid-email')).toEqual([]);
    });

    it('extracts username tokens from email with dots, pluses, and hyphens', () => {
      const tokens = extractEmailTokens('raj.patel+test@example.com');
      expect(tokens).toContain('raj.patel+test');
      expect(tokens).toContain('raj');
      expect(tokens).toContain('patel');
      expect(tokens).toContain('test');
    });

    it('filters out tokens shorter than 3 characters', () => {
      const tokens = extractEmailTokens('ab.cd@example.com');
      expect(tokens).toEqual([]);
    });
  });

  describe('containsEmailUsername', () => {
    it('detects when password contains user email username', () => {
      expect(containsEmailUsername('RajPatel123!', 'raj.patel@example.com')).toBe(true);
      expect(containsEmailUsername('mysecret123!', 'secret@example.com')).toBe(true);
    });

    it('returns false when password does not contain email username', () => {
      expect(containsEmailUsername('Kx9#mP2$vL8!', 'john.doe@example.com')).toBe(false);
    });
  });

  describe('checkPasswordStrength rules', () => {
    it('classifies empty or very short password as weak', () => {
      const result = checkPasswordStrength('');
      expect(result.strength).toBe('weak');
      expect(result.score).toBe(2); // no_email_part & not_common are true for empty
      expect(result.unmetRules).toContain('At least 8 characters');
      expect(result.unmetRules).toContain('At least one uppercase letter (A-Z)');
      expect(result.unmetRules).toContain('At least one lowercase letter (a-z)');
      expect(result.unmetRules).toContain('At least one number (0-9)');
      expect(result.unmetRules).toContain('At least one special character (!@#$%^&*)');
    });

    it('fails min_length rule when password length is less than 8', () => {
      const result = checkPasswordStrength('Aa1!bcd');
      expect(result.rules.find((r) => r.id === 'min_length')?.met).toBe(false);
      expect(result.strength).toBe('weak'); // even with 4 rules, min length is required for fair
    });

    it('fails uppercase rule when uppercase letters are missing', () => {
      const result = checkPasswordStrength('validpassword123!');
      expect(result.rules.find((r) => r.id === 'uppercase')?.met).toBe(false);
      expect(result.strength).toBe('fair');
    });

    it('fails lowercase rule when lowercase letters are missing', () => {
      const result = checkPasswordStrength('VALIDPASSWORD123!');
      expect(result.rules.find((r) => r.id === 'lowercase')?.met).toBe(false);
      expect(result.strength).toBe('fair');
    });

    it('fails number rule when numbers are missing', () => {
      const result = checkPasswordStrength('ValidPassword!@#');
      expect(result.rules.find((r) => r.id === 'number')?.met).toBe(false);
      expect(result.strength).toBe('fair');
    });

    it('fails special character rule when symbols are missing', () => {
      const result = checkPasswordStrength('ValidPassword123');
      expect(result.rules.find((r) => r.id === 'special_char')?.met).toBe(false);
      expect(result.strength).toBe('fair');
    });

    it('fails no_email_part rule when password contains email username', () => {
      const result = checkPasswordStrength('RajPatel123!', 'raj.patel@example.com');
      expect(result.rules.find((r) => r.id === 'no_email_part')?.met).toBe(false);
      expect(result.strength).toBe('fair');
      expect(result.unmetRules).toContain('Does not contain your name or email');
    });

    it('fails not_common rule when password is a known weak password', () => {
      const result = checkPasswordStrength('Password123!');
      expect(result.rules.find((r) => r.id === 'not_common')?.met).toBe(false);
      expect(result.strength).toBe('fair');
      expect(result.unmetRules).toContain('Not a common weak password');
    });

    it('returns strong when all 7 rules are met', () => {
      const result = checkPasswordStrength('Str0ngP@ssw0rd!2026', 'unrelated.candidate@example.com');
      expect(result.score).toBe(7);
      expect(result.strength).toBe('strong');
      expect(result.unmetRules).toEqual([]);
      expect(result.rules.every((r) => r.met)).toBe(true);
    });

    it('returns fair when length >= 8 and at least 4 rules pass but not all 7', () => {
      // Missing symbol and missing uppercase, but length, lowercase, number, no_email, not_common pass (5 passed)
      const result = checkPasswordStrength('lowercaseonly123', 'unrelated@example.com');
      expect(result.rules.find((r) => r.id === 'min_length')?.met).toBe(true);
      expect(result.score).toBe(5);
      expect(result.strength).toBe('fair');
    });
  });
});
