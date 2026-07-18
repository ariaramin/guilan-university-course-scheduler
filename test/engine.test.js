import assert from 'node:assert/strict';
import test from 'node:test';

import { eligibility, examsOverlap, generateSchedules, overlaps } from '../extension/lib/engine.js';

const group = (id, courseId, day, start, end, extra = {}) => ({
  id, courseId, title: courseId, units: 3, available: true,
  sessions: [{ day, start, end, week: 'all' }], exam: null, ...extra,
});

test('detects partial class overlap but not touching boundaries or odd/even separation', () => {
  assert.equal(overlaps({ day: 0, start: 480, end: 570 }, { day: 0, start: 540, end: 600 }), true);
  assert.equal(overlaps({ day: 0, start: 480, end: 570 }, { day: 0, start: 570, end: 600 }), false);
  assert.equal(overlaps({ day: 0, start: 480, end: 570, week: 'odd' }, { day: 0, start: 500, end: 550, week: 'even' }), false);
});

test('unknown exam time is flagged for review, not treated as a definite conflict', () => {
  assert.equal(examsOverlap(
    { date: '1405-10-01', start: null, end: null },
    { date: '1405-10-01', start: 600, end: 720 },
  ), false);
  assert.deepEqual(eligibility(
    group('A-1', 'A', 0, 480, 540, { exam: { date: '1405-10-01', start: null, end: null } }),
    { passedCourseIds: [], selectedCourseIds: [] },
  ).warnings, ['ساعت امتحان نامشخص است.']);
});

test('evaluates AND/OR prerequisites and same-term corequisites', () => {
  const target = group('T-1', 'T', 0, 480, 540, {
    prerequisites: { op: 'OR', items: [{ courseId: 'A' }, { courseId: 'B' }] },
    corequisites: { op: 'AND', items: [{ courseId: 'C' }] },
  });
  assert.equal(eligibility(target, { passedCourseIds: ['B'], selectedCourseIds: ['C'] }).eligible, true);
  assert.deepEqual(eligibility(target, { passedCourseIds: [], selectedCourseIds: [] }).reasons, [
    'پیش‌نیاز کامل نیست.', 'هم‌نیاز پاس نشده یا انتخاب نشده است.',
  ]);
});

test('backtracking prunes conflicts and includes a required group', () => {
  const groups = [
    group('A-1', 'A', 0, 480, 540),
    group('A-2', 'A', 1, 480, 540),
    group('B-1', 'B', 0, 510, 570),
  ];
  const schedules = generateSchedules(groups, { minUnits: 6, maxUnits: 6, requiredGroupIds: ['B-1'] });
  assert.deepEqual(schedules.map((item) => item.groups.map(({ id }) => id).sort()), [['A-2', 'B-1']]);
});

test('accepts a same-term corequisite only when both courses are selected', () => {
  const groups = [
    group('A-1', 'A', 0, 480, 540, { corequisites: { op: 'AND', items: [{ courseId: 'B' }] } }),
    group('B-1', 'B', 1, 480, 540),
  ];
  assert.equal(generateSchedules(groups, { minUnits: 6, maxUnits: 6 }).length, 1);
  assert.equal(generateSchedules(groups, { minUnits: 3, maxUnits: 3, requiredGroupIds: ['A-1'] }).length, 0);
});

test('ranks schedules with preferred groups first', () => {
  const groups = [group('A-1', 'A', 0, 480, 540), group('B-1', 'B', 1, 480, 540)];
  const schedules = generateSchedules(groups, { minUnits: 3, maxUnits: 3, preferredGroupIds: ['B-1'] });
  assert.equal(schedules[0].groups[0].id, 'B-1');
});

test('never schedules a group with no remaining capacity', () => {
  const unavailable = group('A-1', 'A', 0, 480, 540, { available: false });
  assert.equal(generateSchedules([unavailable], { minUnits: 0 }).length, 0);
});

test('ranks closest lower total before closest higher total when exact target is impossible', () => {
  const groups = [group('A-1', 'A', 0, 480, 540), group('B-1', 'B', 1, 480, 540)];
  const schedules = generateSchedules(groups, { targetUnits: 5, maxUnits: 6 });
  assert.equal(schedules[0].units, 3);
  assert.equal(schedules.find((item) => item.units === 6)?.units, 6);
});

test('excludes courses with unknown units from suggested schedules', () => {
  const unknown = group('A-1', 'A', 0, 480, 540, { units: 0, unitsKnown: false });
  assert.deepEqual(generateSchedules([unknown], { targetUnits: 3 }), []);
  assert.equal(eligibility(unknown, { passedCourseIds: [] }).eligible, false);
  assert.match(eligibility(unknown, { passedCourseIds: [] }).reasons.join(' '), /نامشخص/);
});

test('ranks exact, lower, then higher schedules and omits unresolved units', () => {
  const groups = [
    group('A-1', 'A', 0, 480, 540, { units: 5 }),
    group('B-1', 'B', 1, 480, 540, { units: 4 }),
    group('C-1', 'C', 2, 480, 540, { units: 6 }),
    group('D-1', 'D', 3, 480, 540, { units: 0, unitsKnown: false }),
  ];
  const schedules = generateSchedules(groups, { targetUnits: 5, maxUnits: 6, maxCourses: 1 });
  assert.deepEqual(schedules.slice(0, 3).map((item) => [item.units, item.unitsComplete]), [
    [5, true], [4, true], [6, true],
  ]);
});

test('keeps a 500-course search within the bounded performance budget', () => {
  const groups = Array.from({ length: 500 }, (_, index) => group(
    `G${index}`,
    `C${index}`,
    index % 6,
    480 + (index % 8) * 90,
    540 + (index % 8) * 90,
    { capacity: index % 30 + 1 },
  ));
  const start = performance.now();
  const schedules = generateSchedules(groups, { targetUnits: 20, maxUnits: 30, limit: 20 });
  assert.equal(schedules.length, 20);
  assert.ok(performance.now() - start < 3000);
});

test('keeps a 2000-course search bounded', () => {
  const groups = Array.from({ length: 2000 }, (_, index) => group(
    `G${index}`, `C${index}`, index % 6, 480 + (index % 8) * 90, 540 + (index % 8) * 90,
    { capacity: index % 30 + 1 },
  ));
  const start = performance.now();
  const schedules = generateSchedules(groups, { targetUnits: 20, maxUnits: 30, limit: 20 });
  assert.equal(schedules.length, 20);
  assert.ok(performance.now() - start < 5000);
});
