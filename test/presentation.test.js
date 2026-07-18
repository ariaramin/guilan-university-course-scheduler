import assert from 'node:assert/strict';
import test from 'node:test';

import { formatCapacity, formatExam, formatSessions, formatTerm, formatTuition } from '../extension/lib/presentation.js';

test('formats class sessions with Persian days, digits, and wording', () => {
  assert.equal(formatSessions([{ day: 4, start: 840, end: 1020, week: 'all' }]), 'چهارشنبه، ساعت ۱۴ تا ۱۷');
});

test('formats Jalali exam date with its full Persian weekday', () => {
  assert.equal(
    formatExam({ date: '1405-04-25', start: 840, end: 1020, location: 'دانشکده فنی' }),
    'پنجشنبه ۱۴۰۵/۰۴/۲۵ ساعت ۱۴ تا ۱۷ (دانشکده فنی)',
  );
});

test('uses human messages for incomplete exam, capacity, and tuition data', () => {
  assert.equal(formatExam(null), 'زمان امتحان اعلام نشده است');
  assert.equal(formatCapacity(0), 'ظرفیت تکمیل شده است');
  assert.equal(formatCapacity(-1), 'وضعیت ظرفیت نامشخص است');
  assert.equal(formatTuition({ amount: 1000, currency: null }), 'شهریه اعلام نشده است');
  assert.equal(formatTuition({ amount: 1250000, currency: 'IRR' }), '۱٬۲۵۰٬۰۰۰ ریال');
});

test('formats terms and large counts with Persian numerals and separators', () => {
  assert.equal(formatTerm('14043'), 'ترم ۳ · ۱۴۰۴');
  assert.equal(formatCapacity(2500), '۲٬۵۰۰ نفر ظرفیت باقی‌مانده');
});
