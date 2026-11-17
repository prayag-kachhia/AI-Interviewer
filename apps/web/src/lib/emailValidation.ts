/**
 * Utility for client-side RFC 5322-compliant email format validation.
 *
 * Validates syntax without attempting intrusive network lookups,
 * domain pinging, or mailbox existence checks.
 */

export interface EmailValidationResult {
  isValid: boolean;
  normalizedEmail: string;
  error?: string;
}

// RFC 5322-practical email regex:
// - Local part: alphanumeric and standard allowed symbols, no consecutive dots.
// - Domain part: labels with letters/digits/hyphens, separated by dots.
// - TLD: minimum 2 alphabetic characters.
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): EmailValidationResult {
  const normalized = (email || '').trim().toLowerCase();

  if (!normalized) {
    return {
      isValid: false,
      normalizedEmail: '',
      error: 'Email address is required.',
    };
  }

  // Reject internal spaces
  if (/\s/.test(normalized)) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email address must not contain spaces.',
    };
  }

  // Check for exactly one '@'
  const parts = normalized.split('@');
  if (parts.length !== 2) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Please enter a valid email address with a single @ symbol.',
    };
  }

  const [localPart, domainPart] = parts;

  if (!localPart) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email is missing the username before the @ symbol.',
    };
  }

  if (localPart.length > 64) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email username cannot exceed 64 characters.',
    };
  }

  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email username cannot start or end with a dot.',
    };
  }

  if (localPart.includes('..')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email username cannot contain consecutive dots.',
    };
  }

  if (!domainPart) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email is missing the domain after the @ symbol.',
    };
  }

  if (domainPart.length > 255) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email domain cannot exceed 255 characters.',
    };
  }

  if (domainPart.includes('..')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email domain cannot contain consecutive dots.',
    };
  }

  if (!domainPart.includes('.')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Email domain must include a top-level domain (e.g., .com, .org).',
    };
  }

  if (!EMAIL_REGEX.test(normalized)) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      error: 'Please enter a valid email address format (e.g., name@example.com).',
    };
  }

  return {
    isValid: true,
    normalizedEmail: normalized,
  };
}

export function isValidEmail(email: string): boolean {
  return validateEmail(email).isValid;
}
