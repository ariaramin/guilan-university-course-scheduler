import assert from 'node:assert/strict';
import test from 'node:test';

import { applyCourseUnits, normalizeCourseName, parseCourseUnitFile } from '../extension/lib/course-units.js';

test('normalizes Persian/Arabic letters, digits, spacing, and punctuation', () => {
  assert.equal(normalizeCourseName(' رياضي‌ ١ (عمومي)، '), 'ریاضی 1 عمومی');
  assert.equal(normalizeCourseName('\u202b(فقط مرد) دانش خانواده و جمعیت گروه ۲\u202c'), 'دانش خانواده و جمعیت');
  assert.equal(normalizeCourseName('آشنائي با مهندسي برق'), 'آشنایی با مهندسی برق');
});

test('reads JSON and CSV course-unit files into an exact-match Map', () => {
  assert.equal(parseCourseUnitFile('{"ریاضی ۱":3}', 'units.json').get('ریاضی 1'), 3);
  assert.equal(parseCourseUnitFile('نام درس,تعداد واحد\n"فیزیک، ۲",3', 'units.csv').get('فیزیک 2'), 3);
});

test('marks unmatched course names and never guesses their units', () => {
  const groups = applyCourseUnits([
    { title: 'ریاضی ۱', units: 0 }, { title: 'ریاضی ۲', units: 0 },
  ], new Map([['ریاضی 1', 3]]));
  assert.deepEqual(groups.map(({ units, unitsKnown }) => ({ units, unitsKnown })), [
    { units: 3, unitsKnown: true }, { units: 0, unitsKnown: false },
  ]);
});

test('returns human errors for malformed or conflicting unit files', () => {
  assert.throws(() => parseCourseUnitFile('{bad', 'units.json'), /JSON معتبر نیست/);
  assert.throws(() => parseCourseUnitFile('[{"name":"ریاضی","units":2},{"name":"ریاضی","units":3}]', 'units.json'), /دو تعداد واحد متفاوت/);
});
