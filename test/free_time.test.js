import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateGapsForSessions, formatGapsForDay } from '../extension/lib/free-time.js';

test('no classes (empty sessions) returns empty gaps', () => {
  assert.deepEqual(calculateGapsForSessions([]), []);
  assert.equal(formatGapsForDay([]), 'بدون فاصله');
});

test('single class returns empty gaps', () => {
  const sessions = [{ day: 0, start: 480, end: 570, week: 'all' }]; // 8:00 - 9:30
  assert.deepEqual(calculateGapsForSessions(sessions), []);
  assert.equal(formatGapsForDay(calculateGapsForSessions(sessions)), 'بدون فاصله');
});

test('adjacent classes merge with no gaps', () => {
  const sessions = [
    { day: 0, start: 480, end: 570, week: 'all' },  // 8:00 - 9:30
    { day: 0, start: 570, end: 660, week: 'all' }   // 9:30 - 11:00
  ];
  assert.deepEqual(calculateGapsForSessions(sessions), []);
});

test('overlapping classes merge with no gaps', () => {
  const sessions = [
    { day: 0, start: 480, end: 600, week: 'all' },  // 8:00 - 10:00
    { day: 0, start: 540, end: 660, week: 'all' }   // 9:00 - 11:00
  ];
  assert.deepEqual(calculateGapsForSessions(sessions), []);
});

test('one gap between classes is correctly calculated', () => {
  const sessions = [
    { day: 0, start: 480, end: 570, week: 'all' },  // 8:00 - 9:30
    { day: 0, start: 660, end: 750, week: 'all' }   // 11:00 - 12:30
  ];
  const expected = [{ start: 570, end: 660, duration: 90 }];
  assert.deepEqual(calculateGapsForSessions(sessions), expected);
  assert.equal(formatGapsForDay(expected), '۹:۳۰ تا ۱۱ — ۱ ساعت و ۳۰ دقیقه');
});

test('multiple gaps are correctly calculated', () => {
  const sessions = [
    { day: 0, start: 480, end: 570, week: 'all' },  // 8:00 - 9:30
    { day: 0, start: 660, end: 750, week: 'all' },  // 11:00 - 12:30
    { day: 0, start: 840, end: 930, week: 'all' }   // 14:00 - 15:30
  ];
  const expected = [
    { start: 570, end: 660, duration: 90 },
    { start: 750, end: 840, duration: 90 }
  ];
  assert.deepEqual(calculateGapsForSessions(sessions), expected);
  assert.equal(formatGapsForDay(expected), '۹:۳۰ تا ۱۱ — ۱ ساعت و ۳۰ دقیقه · ۱۲:۳۰ تا ۱۴ — ۱ ساعت و ۳۰ دقیقه');
});

test('unsorted sessions are correctly sorted and calculated', () => {
  const sessions = [
    { day: 0, start: 840, end: 930, week: 'all' },  // 14:00 - 15:30
    { day: 0, start: 480, end: 570, week: 'all' },  // 8:00 - 9:30
    { day: 0, start: 660, end: 750, week: 'all' }   // 11:00 - 12:30
  ];
  const expected = [
    { start: 570, end: 660, duration: 90 },
    { start: 750, end: 840, duration: 90 }
  ];
  assert.deepEqual(calculateGapsForSessions(sessions), expected);
});

test('invalid ranges (start >= end) are ignored', () => {
  const sessions = [
    { day: 0, start: 480, end: 570, week: 'all' },
    { day: 0, start: 600, end: 500, week: 'all' }, // invalid
    { day: 0, start: 660, end: 750, week: 'all' }
  ];
  const expected = [{ start: 570, end: 660, duration: 90 }];
  assert.deepEqual(calculateGapsForSessions(sessions), expected);
});

test('formatting different durations', () => {
  assert.equal(formatGapsForDay([{ start: 600, end: 650, duration: 50 }]), '۱۰ تا ۱۰:۵۰ — ۵۰ دقیقه');
  assert.equal(formatGapsForDay([{ start: 600, end: 660, duration: 60 }]), '۱۰ تا ۱۱ — ۱ ساعت');
  assert.equal(formatGapsForDay([{ start: 600, end: 695, duration: 95 }]), '۱۰ تا ۱۱:۳۵ — ۱ ساعت و ۳۵ دقیقه');
  assert.equal(formatGapsForDay([{ start: 600, end: 720, duration: 120 }]), '۱۰ تا ۱۲ — ۲ ساعت');
  assert.equal(formatGapsForDay([{ start: 600, end: 785, duration: 185 }]), '۱۰ تا ۱۳:۰۵ — ۳ ساعت و ۵ دقیقه');
});
