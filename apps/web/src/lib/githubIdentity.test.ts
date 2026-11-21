import { describe, expect, it } from 'vitest';
import {
  extractGitHubUsername,
  getVerifiedGitHubUsername,
  hasGitHubIdentity,
  hasGoogleIdentity,
  getOAuthErrorFromUrl,
} from './githubIdentity';

describe('githubIdentity helper logic', () => {
  describe('extractGitHubUsername', () => {
    it('returns null for null or undefined input', () => {
      expect(extractGitHubUsername(null)).toBeNull();
      expect(extractGitHubUsername(undefined)).toBeNull();
    });

    it('returns null for non-github providers', () => {
      expect(
        extractGitHubUsername({
          provider: 'google',
          identity_data: { user_name: 'octocat', email: 'octocat@gmail.com' },
        })
      ).toBeNull();

      expect(
        extractGitHubUsername({
          provider: 'email',
          identity_data: { user_name: 'octocat' },
        })
      ).toBeNull();
    });

    it('extracts username from identity_data.user_name', () => {
      expect(
        extractGitHubUsername({
          provider: 'github',
          identity_data: { user_name: 'vismay-solanki' },
        })
      ).toBe('vismay-solanki');
    });

    it('extracts username from identity_data.preferred_username if user_name is absent', () => {
      expect(
        extractGitHubUsername({
          provider: 'github',
          identity_data: { preferred_username: 'octocat' },
        })
      ).toBe('octocat');
    });

    it('extracts username from identity_data.login if user_name and preferred_username are absent', () => {
      expect(
        extractGitHubUsername({
          provider: 'github',
          identity_data: { login: 'dev-user' },
        })
      ).toBe('dev-user');
    });

    it('trims leading and trailing whitespace from the username', () => {
      expect(
        extractGitHubUsername({
          provider: 'github',
          identity_data: { user_name: '   vismay-trimmed   ' },
        })
      ).toBe('vismay-trimmed');
    });

    it('never uses full_name or name display fields as a username', () => {
      expect(
        extractGitHubUsername({
          provider: 'github',
          identity_data: {
            name: 'Vismay Solanki',
            full_name: 'Vismay Solanki',
          },
        })
      ).toBeNull();
    });

    it('returns null if identity_data is empty or missing', () => {
      expect(extractGitHubUsername({ provider: 'github' })).toBeNull();
      expect(extractGitHubUsername({ provider: 'github', identity_data: {} })).toBeNull();
      expect(extractGitHubUsername({ provider: 'github', identity_data: { user_name: '' } })).toBeNull();
      expect(extractGitHubUsername({ provider: 'github', identity_data: { user_name: '   ' } })).toBeNull();
    });
  });

  describe('getVerifiedGitHubUsername', () => {
    it('returns null when identities list is empty or null', () => {
      expect(getVerifiedGitHubUsername(null)).toBeNull();
      expect(getVerifiedGitHubUsername(undefined)).toBeNull();
      expect(getVerifiedGitHubUsername([])).toBeNull();
    });

    it('finds and extracts username from a list containing multiple providers', () => {
      const identities = [
        { provider: 'email', identity_data: { email: 'test@example.com' } },
        { provider: 'google', identity_data: { email: 'test@gmail.com', name: 'Google User' } },
        { provider: 'github', identity_data: { user_name: 'verified-coder' } },
      ];
      expect(getVerifiedGitHubUsername(identities)).toBe('verified-coder');
    });

    it('returns null if list contains github identity with no username', () => {
      const identities = [
        { provider: 'github', identity_data: { email: 'gh@example.com' } },
      ];
      expect(getVerifiedGitHubUsername(identities)).toBeNull();
    });
  });

  describe('hasGitHubIdentity and hasGoogleIdentity', () => {
    it('correctly detects presence of github identity', () => {
      expect(hasGitHubIdentity([])).toBe(false);
      expect(hasGitHubIdentity([{ provider: 'google' }])).toBe(false);
      expect(hasGitHubIdentity([{ provider: 'google' }, { provider: 'github' }])).toBe(true);
    });

    it('correctly detects presence of google identity', () => {
      expect(hasGoogleIdentity([])).toBe(false);
      expect(hasGoogleIdentity([{ provider: 'github' }])).toBe(false);
      expect(hasGoogleIdentity([{ provider: 'google' }])).toBe(true);
    });
  });

  describe('getOAuthErrorFromUrl', () => {
    it('extracts error_description from query string', () => {
      const search = '?error=server_error&error_description=Identity+is+already+linked+to+another+user';
      expect(getOAuthErrorFromUrl(search, '')).toBe('Identity is already linked to another user');
    });

    it('extracts error_description from hash fragment', () => {
      const hash = '#error=server_error&error_description=User+cancelled+authorization';
      expect(getOAuthErrorFromUrl('', hash)).toBe('User cancelled authorization');
    });

    it('handles descriptions containing literal percent signs without throwing', () => {
      const search = '?error=access_denied&error_description=Failed+100%25+of+attempts';
      expect(getOAuthErrorFromUrl(search, '')).toBe('Failed 100% of attempts');
      const hash = '#error=server_error&error_description=Quota+exceeded+by+50%25';
      expect(getOAuthErrorFromUrl('', hash)).toBe('Quota exceeded by 50%');
      const literalPercent = '?error=server_error&error_description=Usage+at+100%+capacity';
      expect(getOAuthErrorFromUrl(literalPercent, '')).toBe('Usage at 100% capacity');
    });

    it('falls back to error code if description is absent', () => {
      expect(getOAuthErrorFromUrl('?error=access_denied', '')).toBe('Authentication error: access_denied');
    });

    it('returns empty string if no error parameters are present', () => {
      expect(getOAuthErrorFromUrl('', '')).toBe('');
      expect(getOAuthErrorFromUrl('?code=auth-code-123', '#access_token=token-123')).toBe('');
    });
  });
});
