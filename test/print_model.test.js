import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrintModel } from '../extension/lib/print-model.js';

test('builds an all-Persian printable schedule model', () => {
  const model = buildPrintModel([{ unitsComplete: true, units: 20, groups: [{
    title: 'ریاضی عمومی', instructor: 'استاد نمونه', sessions: [{ day: 4, start: 840, end: 1020 }],
    exam: { date: '1405-04-25', start: 840, end: 1020, location: 'دانشکده فنی' },
    degree: 'کارشناسی', termId: '14043', capacity: 12, tuition: { amount: 2500000, currency: 'IRR' },
  }] }], new Date('2026-07-16T10:00:00Z'));
  assert.equal(model.programs[0].units, '۲۰ واحد');
  assert.equal(model.programs[0].courses[0].term, 'ترم ۳ · ۱۴۰۴');
  assert.equal(model.programs[0].courses[0].tuition, '۲٬۵۰۰٬۰۰۰ ریال');
  assert.equal(model.programs[0].week[0].day, 'چهارشنبه');
  assert.doesNotMatch(JSON.stringify(model), /\d/);
});
