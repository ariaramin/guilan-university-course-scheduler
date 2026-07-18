import assert from 'node:assert/strict';
import test from 'node:test';

import {
  courseDatasetFingerprint, createRequestGate, extractionDiagnostic,
} from '../extension/lib/freshness.js';

const group = (overrides = {}) => ({
  id: '101-1', courseId: '101', title: 'ریاضی عمومی', groupNumber: '1', instructor: 'استاد',
  capacity: 2, termId: '14043', degree: 'کارشناسی', genderEligibility: 'all',
  sessions: [{ day: 0, start: 480, end: 600, week: 'all' }], exam: null, ...overrides,
});

test('course fingerprint is stable but changes when row content changes without changing row count', () => {
  const first = courseDatasetFingerprint([group()]);
  assert.equal(first, courseDatasetFingerprint([structuredClone(group())]));
  assert.notEqual(first, courseDatasetFingerprint([group({ capacity: 1 })]));
  assert.notEqual(first, courseDatasetFingerprint([group({ instructor: 'استاد دیگر' })]));
  assert.equal(
    courseDatasetFingerprint([group(), group({ id: '102-1', courseId: '102' })]),
    courseDatasetFingerprint([group({ id: '102-1', courseId: '102' }), group()]),
  );
});

test('request gate rejects older responses and duplicate datasets', () => {
  const gate = createRequestGate();
  gate.begin('new-request');
  assert.equal(gate.accept({ requestId: 'old-request', fingerprint: 'old' }), false);
  assert.equal(gate.accept({ requestId: 'new-request', fingerprint: 'fresh' }), true);
  assert.equal(gate.accept({ requestId: 'new-request', fingerprint: 'fresh' }), false);
});

test('extraction diagnostics expose state without raw page or course content', () => {
  const diagnostic = extractionDiagnostic({
    requestId: 'r1', rowCount: 12, selectorFound: true, observerStatus: 'connected',
    pagePath: '/Subsystem/Amozesh', capturedAt: '2026-07-18T10:00:00.000Z', durationMs: 40,
    pageTitle: 'private title', tables: [{ rows: [['private course']] }],
  });
  assert.deepEqual(diagnostic, {
    requestId: 'r1', rowCount: 12, selectorFound: true, observerStatus: 'connected',
    pagePath: '/Subsystem/Amozesh', capturedAt: '2026-07-18T10:00:00.000Z', durationMs: 40,
  });
});
