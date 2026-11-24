import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

test('parseAmount handles Italian and dot formats', () => {
  assert.equal(L.parseAmount('12,5'), 1250);
  assert.equal(L.parseAmount('12.50'), 1250);
  assert.equal(L.parseAmount('1.234,56'), 123456);
  assert.equal(L.parseAmount('€ 7'), 700);
  assert.equal(L.parseAmount('abc'), null);
  assert.equal(L.parseAmount('1,234'), null);
  assert.equal(L.parseAmount(''), null);
});

test('formatEuro', () => {
  assert.equal(L.formatEuro(123456), '€ 1.234,56');
  assert.equal(L.formatEuro(123456, { decimals: false }), '€ 1.235');
});

test('shiftMonth crosses years', () => {
  assert.equal(L.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(L.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(L.shiftMonth('2026-05', -13), '2025-04');
});

test('monthly recurrence clamps day 31 and returns to 31', () => {
  const r = { freq: 'monthly', anchorDate: '2026-01-31' };
  assert.equal(L.occurrenceDate(r, 1), '2026-02-28');
  assert.equal(L.occurrenceDate(r, 2), '2026-03-31');
  assert.equal(L.occurrenceDate(r, 3), '2026-04-30');
});

test('yearly recurrence on Feb 29', () => {
  const r = { freq: 'yearly', anchorDate: '2028-02-29' };
  assert.equal(L.occurrenceDate(r, 1), '2029-02-28');
  assert.equal(L.occurrenceDate(r, 4), '2032-02-29');
});

test('weekly recurrence', () => {
  assert.equal(L.occurrenceDate({ freq: 'weekly', anchorDate: '2026-12-28' }, 1), '2027-01-04');
});

test('materializeRecurring catches up missed occurrences and stops at today', () => {
  let n = 0;
  const rules = [
    { id: 'r1', active: true, freq: 'monthly', anchorDate: '2026-08-01', nextIndex: 1, amount: 50000, categoryId: 'casa', note: 'Affitto' },
    { id: 'r2', active: false, freq: 'weekly', anchorDate: '2026-08-01', nextIndex: 1, amount: 100, categoryId: 'x', note: '' },
  ];
  const created = L.materializeRecurring(rules, '2026-11-24', () => `e${++n}`);
  assert.deepEqual(created.map((e) => e.date), ['2026-09-01', '2026-10-01', '2026-11-01']);
  assert.equal(rules[0].nextIndex, 4);
  assert.equal(created[0].recurringId, 'r1');
  assert.equal(L.materializeRecurring(rules, '2026-11-24', () => 'z').length, 0);
});

test('upcomingThisMonth lists future occurrences in the current month only', () => {
  const rules = [
    { id: 'a', active: true, freq: 'weekly', anchorDate: '2026-11-03', nextIndex: 4, amount: 1 },
    { id: 'b', active: true, freq: 'monthly', anchorDate: '2026-10-05', nextIndex: 2, amount: 1 },
  ];
  // a: 3,10,17,24 -> next index 4 = Dec 1 -> none. b: next = Dec 5 -> none
  assert.equal(L.upcomingThisMonth(rules, '2026-11-24').length, 0);
  rules[0].nextIndex = 3; // Nov 24 -> today, not after today
  assert.equal(L.upcomingThisMonth(rules, '2026-11-23').length, 1);
});

test('comparisonRanges: current month compares same span, past compares full', () => {
  const c = L.comparisonRanges('2026-03', '2026-03-31');
  assert.deepEqual(c.previous, ['2026-02-01', '2026-02-28']);
  assert.equal(c.partial, true);
  const p = L.comparisonRanges('2026-02', '2026-03-31');
  assert.deepEqual(p.current, ['2026-02-01', '2026-02-28']);
  assert.deepEqual(p.previous, ['2026-01-01', '2026-01-31']);
  assert.equal(p.partial, false);
});

test('monthSummary totals and compare', () => {
  const ex = [
    { amount: 1000, categoryId: 'a', date: '2026-11-02' },
    { amount: 500, categoryId: 'b', date: '2026-11-20' },
    { amount: 700, categoryId: 'a', date: '2026-10-05' },
    { amount: 9999, categoryId: 'a', date: '2026-10-25' },
  ];
  const s = L.monthSummary(ex, '2026-11', '2026-11-10');
  assert.equal(s.total, 1500);
  assert.equal(s.by.a, 1000);
  assert.equal(s.compare.cur.total, 1000); // up to Nov 10
  assert.equal(s.compare.prev.total, 700); // up to Oct 10
});

test('limit levels and crossings', () => {
  assert.equal(L.limitLevel(100, null), 'none');
  assert.equal(L.limitLevel(79, 100), 'ok');
  assert.equal(L.limitLevel(80, 100), 'warn');
  assert.equal(L.limitLevel(100, 100), 'warn');
  assert.equal(L.limitLevel(101, 100), 'over');
  assert.equal(L.crossedLevel(50, 85, 100), 'warn');
  assert.equal(L.crossedLevel(85, 90, 100), null);
  assert.equal(L.crossedLevel(50, 150, 100), 'over');
});

test('searchExpenses ignores accents and case, filters ranges', () => {
  const ex = [
    { id: '1', note: 'Caffè Bar', amount: 150, categoryId: 'f', date: '2026-11-01', createdAt: 1 },
    { id: '2', note: 'Esselunga', amount: 4000, categoryId: 's', date: '2026-11-02', createdAt: 2 },
  ];
  assert.equal(L.searchExpenses(ex, { text: 'caffe' })[0].id, '1');
  assert.equal(L.searchExpenses(ex, { min: 1000 }).length, 1);
  assert.equal(L.searchExpenses(ex, { categoryId: 's', to: '2026-11-01' }).length, 0);
});

test('suggestNotes ranks prefix, then frequency, and remembers last category', () => {
  const ex = [
    { note: 'Esselunga', categoryId: 'spesa', date: '2026-11-01', createdAt: 1 },
    { note: 'esselunga', categoryId: 'casa', date: '2026-11-05', createdAt: 2 },
    { note: 'Bar Esse', categoryId: 'fuori', date: '2026-11-03', createdAt: 3 },
  ];
  const idx = L.buildNoteIndex(ex);
  const s = L.suggestNotes(idx, 'esse');
  assert.equal(s[0].note, 'esselunga');
  assert.equal(s[0].categoryId, 'casa');
  assert.equal(s[1].note, 'Bar Esse');
  assert.equal(L.suggestNotes(idx, 'esselunga').length, 0);
});

test('toCSV uses semicolons, comma decimals and quotes', () => {
  const csv = L.toCSV([{ date: '2026-11-01', amount: 1250, categoryId: 'a', note: 'a;b "c"' }], [{ id: 'a', name: 'Spesa' }]);
  const lines = csv.replace('﻿', '').split('\r\n');
  assert.equal(lines[1], '2026-11-01;12,50;Spesa;"a;b ""c""";');
});

test('reminderICS has daily rule at given time', () => {
  const ics = L.reminderICS('21:30', '2026-11-24');
  assert.match(ics, /DTSTART:20261124T213000/);
  assert.match(ics, /RRULE:FREQ=DAILY/);
});

test('validateBackup', () => {
  assert.equal(L.validateBackup({ app: 'x' }), 'Questo file non è un backup di Spese.');
  assert.equal(L.validateBackup({ app: 'spese', expenses: [], categories: [], recurring: [] }), null);
  assert.ok(L.validateBackup({ app: 'spese', expenses: [{ id: 1 }], categories: [], recurring: [] }));
});
