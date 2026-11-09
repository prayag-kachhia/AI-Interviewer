import { describe, expect, it } from 'vitest';
import {
  LEARNING_RESOURCES,
  RESOURCE_TOPICS,
  getResourceById,
  getResourcesByTopic,
  isValidResourceId,
  normalizeTopic,
} from '../data/resources.js';

describe('V-3 · Curated learning-resource map (Issue #182)', () => {
  it('defines the core technical interview topics', () => {
    expect(RESOURCE_TOPICS).toEqual([
      'DBMS',
      'SQL',
      'OS',
      'CN',
      'OOP',
      'DSA',
      'System Design',
    ]);
  });

  it('holds between 3 and 5 vetted resources per topic', () => {
    for (const topic of RESOURCE_TOPICS) {
      const topicResources = LEARNING_RESOURCES.filter((r) => r.topic === topic);
      expect(topicResources.length).toBeGreaterThanOrEqual(3);
      expect(topicResources.length).toBeLessThanOrEqual(5);
    }
  });

  it('ensures each resource has a unique id and non-empty metadata', () => {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();

    for (const resource of LEARNING_RESOURCES) {
      expect(resource.id).toMatch(/^[a-z0-9-]+$/);
      expect(seenIds.has(resource.id)).toBe(false);
      seenIds.add(resource.id);

      expect(resource.title.trim().length).toBeGreaterThan(0);
      expect(resource.description.trim().length).toBeGreaterThan(0);
      expect(resource.url).toMatch(/^https:\/\//);

      expect(seenUrls.has(resource.url)).toBe(false);
      seenUrls.add(resource.url);

      expect(['documentation', 'tutorial', 'interactive', 'guide']).toContain(resource.type);
      expect(RESOURCE_TOPICS).toContain(resource.topic);
    }
  });

  it('retrieves resources by id and validates known and unknown ids', () => {
    expect(isValidResourceId('dbms-acid-transactions')).toBe(true);
    expect(getResourceById('dbms-acid-transactions')?.title).toContain('ACID');
    expect(isValidResourceId('unknown-resource-id')).toBe(false);
    expect(getResourceById('unknown-resource-id')).toBeUndefined();
  });

  it('retrieves resources by topic case-insensitively and through aliases', () => {
    const dsaResources = getResourcesByTopic('dsa');
    expect(dsaResources.length).toBeGreaterThanOrEqual(3);
    expect(dsaResources.every((r) => r.topic === 'DSA')).toBe(true);

    // Aliased topics
    expect(normalizeTopic('networking')).toBe('CN');
    expect(normalizeTopic('multithreading')).toBe('OS');
    expect(normalizeTopic('relational-databases')).toBe('DBMS');
    expect(normalizeTopic('postgres')).toBe('SQL');
    expect(normalizeTopic('microservices')).toBe('System Design');

    // Retrieve via alias
    const networkResources = getResourcesByTopic('networking');
    expect(networkResources.length).toBeGreaterThanOrEqual(3);
    expect(networkResources.every((r) => r.topic === 'CN')).toBe(true);

    expect(getResourcesByTopic('non-existent-topic')).toEqual([]);
    expect(normalizeTopic('non-existent-topic')).toBeUndefined();
  });
});
