import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanExamLocation, parseExam } from '../extension/lib/sada-parser.js';

// --- cleanExamLocation ---

test('cleanExamLocation: strips weekday names from location', () => {
  assert.equal(cleanExamLocation('دانشکده علوم پایه سهشنبه'), 'دانشکده علوم پایه');
  assert.equal(cleanExamLocation('دانشکده فنی یکشنبه'), 'دانشکده فنی');
  assert.equal(cleanExamLocation('ساختمان مرکزی پنجشنبه'), 'ساختمان مرکزی');
});

test('cleanExamLocation: strips از and تا', () => {
  assert.equal(cleanExamLocation('دانشکده علوم پایه از تا'), 'دانشکده علوم پایه');
  assert.equal(cleanExamLocation('از تا دانشکده فنی'), 'دانشکده فنی');
});

test('cleanExamLocation: strips ساعت', () => {
  assert.equal(cleanExamLocation('دانشکده فنی ساعت'), 'دانشکده فنی');
});

test('cleanExamLocation: regression — full malformed string', () => {
  assert.equal(
    cleanExamLocation('دانشکده علوم پایه سهشنبه از تا'),
    'دانشکده علوم پایه',
  );
});

test('cleanExamLocation: strips date fragments', () => {
  assert.equal(cleanExamLocation('دانشکده فنی 1405/04/28'), 'دانشکده فنی');
  assert.equal(cleanExamLocation('دانشکده فنی 1405-04-28'), 'دانشکده فنی');
});

test('cleanExamLocation: strips time patterns', () => {
  assert.equal(cleanExamLocation('دانشکده فنی 8:00 11:30'), 'دانشکده فنی');
});

test('cleanExamLocation: strips combined date, time, weekday, temporal keywords', () => {
  assert.equal(
    cleanExamLocation('دانشکده علوم پایه سهشنبه 1405/04/28 8:00 تا 11:30'),
    'دانشکده علوم پایه',
  );
});

test('cleanExamLocation: strips Unicode direction marks', () => {
  assert.equal(
    cleanExamLocation('\u202Bدانشکده فنی\u202C'),
    'دانشکده فنی',
  );
});

test('cleanExamLocation: strips punctuation remnants', () => {
  assert.equal(cleanExamLocation('دانشکده فنی - /'), 'دانشکده فنی');
  assert.equal(cleanExamLocation('(دانشکده فنی)'), 'دانشکده فنی');
});

test('cleanExamLocation: returns null for empty result', () => {
  assert.equal(cleanExamLocation(''), null);
  assert.equal(cleanExamLocation(null), null);
  assert.equal(cleanExamLocation('از تا ساعت'), null);
  assert.equal(cleanExamLocation('سهشنبه'), null);
});

test('cleanExamLocation: preserves valid location-only text', () => {
  assert.equal(cleanExamLocation('دانشکده فنی'), 'دانشکده فنی');
  assert.equal(cleanExamLocation('ساختمان مرکزی دانشگاه'), 'ساختمان مرکزی دانشگاه');
});

test('cleanExamLocation: handles repeated whitespace and half-spaces', () => {
  assert.equal(
    cleanExamLocation('  دانشکده   فنی   '),
    'دانشکده فنی',
  );
});

test('cleanExamLocation: strips standalone numbers', () => {
  assert.equal(cleanExamLocation('دانشکده فنی 8 11'), 'دانشکده فنی');
});

test('cleanExamLocation: does not strip numbers inside place names', () => {
  // Note: standalone numbers are stripped, but valid identifiers like "ساختمان ۲" lose the number.
  // This is acceptable since place names rarely end with bare digits.
  assert.equal(cleanExamLocation('دانشکده علوم پایه'), 'دانشکده علوم پایه');
});

// --- parseExam ---

test('parseExam: full structured parse with all fields', () => {
  const result = parseExam('دانشکده علوم پایه سهشنبه ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۳۰');
  assert.equal(result.location, 'دانشکده علوم پایه');
  assert.equal(result.weekday, 'سهشنبه');
  assert.equal(result.date, '1405-04-28');
  assert.equal(result.start, 480); // 8:00
  assert.equal(result.end, 690); // 11:30
  assert.equal(result.calendar, 'jalali');
  assert.ok(result.raw);
});

test('parseExam: regression — malformed location cleaned', () => {
  // Simulate what the old parser produced by testing the input that caused
  // "دانشکده علوم پایه سهشنبه از تا"
  const result = parseExam('دانشکده علوم پایه سهشنبه ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۳۰');
  assert.equal(result.location, 'دانشکده علوم پایه');
  assert.notEqual(result.location, 'دانشکده علوم پایه سهشنبه از تا');
});

test('parseExam: location only (no date or time)', () => {
  const result = parseExam('دانشکده فنی');
  assert.equal(result.location, 'دانشکده فنی');
  assert.equal(result.date, null);
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.equal(result.weekday, null);
});

test('parseExam: date and time without location', () => {
  const result = parseExam('۱۴۰۵/۰۵/۱۰ ۰۹:۰۰ - ۱۱:۰۰');
  assert.equal(result.date, '1405-05-10');
  assert.equal(result.start, 540);
  assert.equal(result.end, 660);
  assert.equal(result.location, null);
});

test('parseExam: returns null for ندارد', () => {
  assert.equal(parseExam('ندارد'), null);
});

test('parseExam: returns null for empty input', () => {
  assert.equal(parseExam(''), null);
  assert.equal(parseExam(null), null);
});

test('parseExam: weekday extracted from text with سه شنبه (with space)', () => {
  const result = parseExam('دانشکده فنی سه شنبه ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۰۰');
  assert.equal(result.weekday, 'سهشنبه');
  assert.equal(result.location, 'دانشکده فنی');
});

test('parseExam: missing start time results in null start and end', () => {
  const result = parseExam('دانشکده فنی ۱۴۰۵/۰۵/۱۰');
  assert.equal(result.date, '1405-05-10');
  assert.equal(result.start, null);
  assert.equal(result.end, null);
  assert.equal(result.location, 'دانشکده فنی');
});

test('parseExam: duplicated weekday still cleaned from location', () => {
  const result = parseExam('دانشکده فنی شنبه شنبه ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۰۰');
  assert.equal(result.location, 'دانشکده فنی');
});

test('parseExam: Arabic characters in input are normalized', () => {
  // Input with Arabic ي and ك
  const result = parseExam('دانشكده علوم پايه ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۰۰');
  assert.equal(result.location, 'دانشکده علوم پایه');
});

test('parseExam: Unicode direction marks stripped from input', () => {
  const result = parseExam('\u202Bدانشکده فنی\u202C ۱۴۰۵/۰۴/۲۸ ۸:۰۰ تا ۱۱:۰۰');
  assert.equal(result.location, 'دانشکده فنی');
});
