'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calc = require('../lib/calc.js');

const MONTHLY = { incomeMode: 'monthly', monthly: 30000, hoursPerWeek: 40 };
// 30000 / (40 * 52 / 12) = 173.0769...
const RATE = 30000 / ((40 * 52) / 12);

test('a monthly salary becomes an hourly rate by the fixed formula', () => {
  assert.equal(calc.hourlyRate(MONTHLY), RATE);
  assert.equal(
    calc.hourlyRate({ incomeMode: 'monthly', monthly: 52000, hoursPerWeek: 40 }),
    52000 / ((40 * 52) / 12),
  );
});

test('an hourly rate is used as given', () => {
  assert.equal(calc.hourlyRate({ incomeMode: 'hourly', hourly: 250, hoursPerWeek: 40 }), 250);
  // hoursPerWeek must not affect an explicitly given hourly rate
  assert.equal(calc.hourlyRate({ incomeMode: 'hourly', hourly: 250, hoursPerWeek: 20 }), 250);
});

test('both income modes agree for equivalent inputs', () => {
  const fromHourly = calc.hourlyRate({ incomeMode: 'hourly', hourly: RATE, hoursPerWeek: 40 });
  assert.equal(calc.hourlyRate(MONTHLY), fromHourly);
  assert.equal(
    calc.priceToTime(1000, calc.hourlyRate(MONTHLY)).totalHours,
    calc.priceToTime(1000, fromHourly).totalHours,
  );
});

test('hours per week other than 40 scales the rate and the workday', () => {
  const part = { incomeMode: 'monthly', monthly: 30000, hoursPerWeek: 20 };
  // Half the hours for the same salary is twice the hourly rate.
  assert.equal(calc.hourlyRate(part), RATE * 2);
  assert.equal(calc.workdayHours(40), 8);
  assert.equal(calc.workdayHours(20), 4);
  assert.equal(calc.workdayHours(37.5), 7.5);
});

test('unusable income settings yield no rate rather than Infinity or NaN', () => {
  assert.equal(calc.hourlyRate({ incomeMode: 'monthly', monthly: 0, hoursPerWeek: 40 }), 0);
  assert.equal(calc.hourlyRate({ incomeMode: 'monthly', monthly: 30000, hoursPerWeek: 0 }), 0);
  assert.equal(calc.hourlyRate({ incomeMode: 'monthly', monthly: -5, hoursPerWeek: 40 }), 0);
  assert.equal(calc.hourlyRate({ incomeMode: 'hourly', hourly: 'abc', hoursPerWeek: 40 }), 0);
  assert.equal(calc.hourlyRate({}), 0);
  assert.equal(calc.hourlyRate(undefined), 0);
});

test('an unusable rate produces null, never a number', () => {
  assert.equal(calc.totalHoursFor(100, 0), null);
  assert.equal(calc.totalHoursFor(100, -5), null);
  assert.equal(calc.totalHoursFor(100, NaN), null);
  assert.equal(calc.totalHoursFor(-100, 50), null);
  assert.equal(calc.priceToTime(100, 0), null);
});

test('minutes are rounded, and a rounded 60 carries into the hour', () => {
  assert.deepEqual(calc.splitHoursMinutes(2.5), { hours: 2, minutes: 30 });
  assert.deepEqual(calc.splitHoursMinutes(3), { hours: 3, minutes: 0 });
  assert.deepEqual(calc.splitHoursMinutes(0.25), { hours: 0, minutes: 15 });
  // 1.99 h is 1 h 59.4 min, which rounds down to 59
  assert.deepEqual(calc.splitHoursMinutes(1.99), { hours: 1, minutes: 59 });
  // 1.999 h is 1 h 59.94 min, which rounds to 60 and must carry
  assert.deepEqual(calc.splitHoursMinutes(1.999), { hours: 2, minutes: 0 });
  assert.deepEqual(calc.splitHoursMinutes(0.9999), { hours: 1, minutes: 0 });
  assert.deepEqual(calc.splitHoursMinutes(0), { hours: 0, minutes: 0 });
  assert.deepEqual(calc.splitHoursMinutes(-1), { hours: 0, minutes: 0 });
});

test('the headline figure reads as hours and minutes', () => {
  assert.equal(calc.formatHoursMinutes(2.5), '2 h 30 min');
  assert.equal(calc.formatHoursMinutes(3), '3 h');
  assert.equal(calc.formatHoursMinutes(0.25), '15 min');
  assert.equal(calc.formatHoursMinutes(0), '0 min');
});

test('the badge is compact, and switches to days past one workday', () => {
  assert.equal(calc.formatBadge(3.75, 40), '3h45m');
  assert.equal(calc.formatBadge(3, 40), '3h');
  assert.equal(calc.formatBadge(0.75, 40), '45m');
  // exactly one workday is already a day
  assert.equal(calc.formatBadge(8, 40), '1d');
  assert.equal(calc.formatBadge(20, 40), '2.5d');
  assert.equal(calc.formatBadge(7.99, 40), '7h59m');
  // ten days and over drop the decimal
  assert.equal(calc.formatBadge(80, 40), '10d');
  assert.equal(calc.formatBadge(100, 40), '13d');
  // a 20-hour week has a 4-hour workday, so the switch comes sooner
  assert.equal(calc.formatBadge(5, 20), '1.3d');
  assert.equal(calc.formatBadge(3.75, 20), '3h45m');
  assert.equal(calc.formatBadge(NaN, 40), '?');
});

test('each framing threshold holds on both sides', () => {
  const week = 40;
  const workday = 8;

  // < 0.10 workdays
  assert.equal(calc.framing(0.79, week), 'A coffee break');
  // < 0.35
  assert.equal(calc.framing(0.8, week), 'A quick errand');
  assert.equal(calc.framing(2.79, week), 'A quick errand');
  // < 0.65
  assert.equal(calc.framing(2.8, week), 'Half your workday');
  assert.equal(calc.framing(5.19, week), 'Half your workday');
  // < 1.20
  assert.equal(calc.framing(5.2, week), 'Your whole Tuesday');
  assert.equal(calc.framing(9.59, week), 'Your whole Tuesday');
  // < 0.60 work weeks
  assert.equal(calc.framing(9.6, week), '1.2 days of your life');
  assert.equal(calc.framing(23.9, week), '3 days of your life');
  // < 1.20 work weeks
  assert.equal(calc.framing(24, week), 'Your whole work week');
  assert.equal(calc.framing(47.9, week), 'Your whole work week');
  // beyond
  assert.equal(calc.framing(48, week), '1.2 work weeks');
  assert.equal(calc.framing(100, week), '2.5 work weeks');

  // the ladder is in workdays, so a 20-hour week moves every boundary
  assert.equal(calc.framing(0.79, 20), 'A quick errand');
  assert.equal(calc.framing(2.8, 20), 'Your whole Tuesday');
  assert.equal(calc.workdayHours(20), workday / 2);
});

test('framing refuses to guess without usable settings', () => {
  assert.equal(calc.framing(5, 0), '');
  assert.equal(calc.framing(NaN, 40), '');
  assert.equal(calc.framing(-1, 40), '');
});

test('the workday bar fills proportionally', () => {
  assert.deepEqual(calc.workdayBlocks(0, 40).filled, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(calc.workdayBlocks(4, 40).filled, [1, 1, 1, 1, 0, 0, 0, 0]);
  assert.deepEqual(calc.workdayBlocks(8, 40).filled, [1, 1, 1, 1, 1, 1, 1, 1]);
  // half of the first block
  assert.deepEqual(calc.workdayBlocks(0.5, 40).filled, [0.5, 0, 0, 0, 0, 0, 0, 0]);
  // two and a half blocks
  assert.deepEqual(calc.workdayBlocks(2.5, 40).filled, [1, 1, 0.5, 0, 0, 0, 0, 0]);
  // the bar always covers one workday, whatever the week length
  assert.deepEqual(calc.workdayBlocks(2, 20).filled, [1, 1, 1, 1, 0, 0, 0, 0]);
});

test('anything past one workday is reported as overflow days', () => {
  assert.equal(calc.workdayBlocks(4, 40).overflowDays, 0);
  assert.equal(calc.workdayBlocks(8, 40).overflowDays, 0);
  assert.equal(calc.workdayBlocks(12, 40).overflowDays, 0.5);
  assert.equal(calc.workdayBlocks(20, 40).overflowDays, 1.5);
  assert.equal(calc.workdayBlocks(80, 40).overflowDays, 9);
  // the bar is full whenever there is overflow
  assert.deepEqual(calc.workdayBlocks(20, 40).filled, [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('the workday bar degrades safely on bad input', () => {
  assert.deepEqual(calc.workdayBlocks(5, 0), { filled: [0, 0, 0, 0, 0, 0, 0, 0], overflowDays: 0 });
  assert.deepEqual(calc.workdayBlocks(NaN, 40), { filled: [0, 0, 0, 0, 0, 0, 0, 0], overflowDays: 0 });
});

test('a worked example holds end to end', () => {
  const rate = calc.hourlyRate(MONTHLY);
  const time = calc.priceToTime(1299, rate);
  assert.equal(time.hours, 7);
  assert.equal(time.minutes, 30);
  assert.equal(calc.formatHoursMinutes(time.totalHours), '7 h 30 min');
  assert.equal(calc.formatBadge(time.totalHours, 40), '7h30m');
  assert.equal(calc.framing(time.totalHours, 40), 'Your whole Tuesday');
});
