export const JOB_TYPES = {
  SESSION_ENDED: 'session.ended',
  INSIGHTS_REFRESH: 'insights.refresh',
  RETENTION_PURGE: 'retention.purge',
  GITHUB_ANALYZE: 'github.analyze',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES] | (string & {});
