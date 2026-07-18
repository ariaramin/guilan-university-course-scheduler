import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CACHE_SCHEMA_VERSION, createCachedCourseDataset, readCachedCourseDataset,
} from '../extension/lib/course-cache.js';

const courses = [{ id: '1', courseId: '1', title: 'ریاضی', units: 3 }];

test('creates and validates an atomic cache with a numeric extraction timestamp', () => {
  const dataset = createCachedCourseDataset({
    courses, extractedAt: 1_700_000_000_000, sourceUrl: 'https://sada.guilan.ac.ir/Dashboard',
    fingerprint: 'abc', selectedTerm: '14043',
  });
  assert.equal(dataset.schemaVersion, CACHE_SCHEMA_VERSION);
  assert.equal(dataset.extractedAt, 1_700_000_000_000);
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: dataset }).status, 'valid');
});

test('distinguishes missing and malformed legacy timestamps without guessing', () => {
  const missing = readCachedCourseDataset({ rawGroups: courses, courseDataMeta: {} });
  assert.equal(missing.status, 'legacy-missing-time');
  assert.equal(missing.dataset.extractedAt, null);
  const malformed = readCachedCourseDataset({ rawGroups: courses, courseDataMeta: { capturedAt: 'not-a-date' } });
  assert.equal(malformed.status, 'legacy-invalid-time');
  assert.equal(malformed.dataset.extractedAt, null);
});

test('migrates a valid legacy timestamp and invalidates schema, source, term, or malformed data mismatches', () => {
  const migrated = readCachedCourseDataset({
    rawGroups: courses,
    courseDataMeta: { capturedAt: '2026-07-18T10:00:00.000Z', fingerprint: 'legacy', sourceUrl: 'https://sada.guilan.ac.ir/Dashboard' },
  });
  assert.equal(migrated.status, 'migrated');
  assert.equal(typeof migrated.dataset.extractedAt, 'number');

  const current = createCachedCourseDataset({
    courses, extractedAt: Date.now(), sourceUrl: 'https://sada.guilan.ac.ir/Dashboard', fingerprint: 'abc', selectedTerm: '14043',
  });
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: { ...current, schemaVersion: 0 } }).status, 'invalid');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: current }, { sourceUrl: 'https://sada.guilan.ac.ir/Other' }).status, 'provisional');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: current }, { selectedTerm: '14044' }).status, 'provisional');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: current }, { fingerprint: 'new-fingerprint' }).status, 'provisional');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: { ...current, courses: null } }).status, 'invalid');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: { ...current, sourceUrl: 'https://example.com/' } }).status, 'invalid');
  assert.equal(readCachedCourseDataset({ cachedCourseDataset: { ...current, courses: [null], courseCount: 1 } }).status, 'invalid');
});
