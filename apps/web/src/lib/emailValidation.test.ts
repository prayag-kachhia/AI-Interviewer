import { describe, it, expect } from 'vitest';
import { validateEmail, isValidEmail } from './emailValidation';

describe('Email Format Validation (Phase 2)', () => {
  describe('Valid Email Addresses', () => {
    it('accepts standard corporate and personal emails', () => {
      expect(isValidEmail('candidate@example.com')).toBe(true);
      expect(isValidEmail('john.doe@company.org')).toBe(true);
      expect(isValidEmail('jane_doe@startup.io')).toBe(true);
      expect(isValidEmail('recruiter-test@agency.co.uk')).toBe(true);
    });

    it('accepts plus-addressing / tags in local part', () => {
      expect(isValidEmail('candidate+interview@gmail.com')).toBe(true);
      expect(isValidEmail('user+tag123@sub.domain.edu')).toBe(true);
    });

    it('accepts diverse valid top-level domains', () => {
      expect(isValidEmail('user@domain.ai')).toBe(true);
      expect(isValidEmail('user@domain.tech')).toBe(true);
      expect(isValidEmail('user@domain.solutions')).toBe(true);
      expect(isValidEmail('developer@innovate.technology')).toBe(true);
      expect(isValidEmail('engineer@company.engineering')).toBe(true);
    });

    it('accepts numeric domain names and short valid addresses', () => {
      expect(isValidEmail('user@163.com')).toBe(true);
      expect(isValidEmail('candidate@123.com')).toBe(true);
      expect(isValidEmail('a@b.org')).toBe(true);
      expect(isValidEmail('x@domain.co')).toBe(true);
    });

    it('trims surrounding whitespace properly', () => {
      const res = validateEmail('   candidate@example.com   \n');
      expect(res.isValid).toBe(true);
      expect(res.normalizedEmail).toBe('candidate@example.com');
    });

    it('lowercases the email address for normalization', () => {
      const res = validateEmail('Candidate.Name@Domain.COM');
      expect(res.isValid).toBe(true);
      expect(res.normalizedEmail).toBe('candidate.name@domain.com');
    });
  });

  describe('Invalid Email Addresses and Clear Error Messages', () => {
    it('rejects empty or whitespace-only email', () => {
      const res = validateEmail('   ');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Email address is required.');
    });

    it('rejects email containing internal spaces', () => {
      const res = validateEmail('user name@example.com');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Email address must not contain spaces.');
    });

    it('rejects emails without @ symbol or with multiple @ symbols', () => {
      expect(validateEmail('plainaddress').error).toContain('single @ symbol');
      expect(validateEmail('user@@example.com').error).toContain('single @ symbol');
      expect(validateEmail('user@name@example.com').error).toContain('single @ symbol');
    });

    it('rejects missing username before @', () => {
      const res = validateEmail('@example.com');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Email is missing the username before the @ symbol.');
    });

    it('rejects missing domain after @', () => {
      const res = validateEmail('candidate@');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Email is missing the domain after the @ symbol.');
    });

    it('rejects leading or trailing dots in local part', () => {
      expect(validateEmail('.user@example.com').error).toContain('cannot start or end with a dot');
      expect(validateEmail('user.@example.com').error).toContain('cannot start or end with a dot');
    });

    it('rejects consecutive dots in local part or domain part', () => {
      expect(validateEmail('user..name@example.com').error).toContain('consecutive dots');
      expect(validateEmail('user@example..com').error).toContain('consecutive dots');
    });

    it('rejects domain without top-level domain (missing dot)', () => {
      const res = validateEmail('user@localhost');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Email domain must include a top-level domain (e.g., .com, .org).');
    });

    it('rejects single-character top-level domains', () => {
      const res = validateEmail('user@example.c');
      expect(res.isValid).toBe(false);
      expect(res.error).toBe('Please enter a valid email address format (e.g., name@example.com).');
    });
  });
});
