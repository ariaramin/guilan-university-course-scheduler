import assert from 'node:assert/strict';
import test from 'node:test';

import { englishDigits, normalizeGroup, parseTimeToMinutes } from '../extension/lib/normalize.js';

test('converts Persian and Arabic digits', () => {
  assert.equal(englishDigits('۱۲۳٤٥٦'), '123456');
});

test('normalizes Persian time and rejects impossible time', () => {
  assert.equal(parseTimeToMinutes('۰۸:۳۰'), 510);
  assert.throws(() => parseTimeToMinutes('25:00'), RangeError);
});

test('normalizes multi-session groups and unknown exam time', () => {
  const group = normalizeGroup({
    id: 'A-1', courseId: 'A', title: 'A', units: 3,
    sessions: [
      { day: 0, start: '08:00', end: '09:30', week: 'odd' },
      { day: 2, start: '۱۰:۰۰', end: '۱۱:۳۰', week: 'all' },
    ],
    exam: { date: '1405-10-01', start: null, end: null },
  });
  assert.deepEqual(group.sessions.map(({ start, end }) => [start, end]), [[480, 570], [600, 690]]);
  assert.equal(group.exam.start, null);
});

test('rejects an invalid session at the input boundary', () => {
  assert.throws(() => normalizeGroup({
    id: 'A-1', courseId: 'A', title: 'A', units: 3,
    sessions: [{ day: 7, start: '10:00', end: '09:00' }],
  }), RangeError);
});

test('keeps explicit gender restrictions and rejects unknown values', () => {
  const base = { id: 'A-1', courseId: 'A', title: 'A', units: 3, sessions: [] };
  assert.equal(normalizeGroup({ ...base, genderRestriction: 'female' }).genderRestriction, 'female');
  assert.throws(() => normalizeGroup({ ...base, genderRestriction: 'unknown' }), TypeError);
});
