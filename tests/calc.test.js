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

// These assert the shape calc returns, not the wording: the strings live in
// lib/i18n.js and are covered by tests/i18n.test.js, which renders these same
// keys in both languages.
test('the headline figure picks the right form for hours and minutes', () => {
  assert.deepEqual(calc.durationParts(2.5), {
    key: 'time.hoursMinutes',
    hours: 2,
    minutes: 30,
  });
  assert.deepEqual(calc.durationParts(3), { key: 'time.hours', hours: 3 });
  assert.deepEqual(calc.durationParts(0.25), { key: 'time.minutes', minutes: 15 });
  assert.deepEqual(calc.durationParts(0), { key: 'time.minutes', minutes: 0 });
});

test('the badge is compact, and switches to days past one workday', () => {
  assert.deepEqual(calc.badgeParts(3.75, 40), {
    key: 'badge.hoursMinutes',
    hours: 3,
    minutes: 45,
  });
  assert.deepEqual(calc.badgeParts(3, 40), { key: 'badge.hours', hours: 3 });
  assert.deepEqual(calc.badgeParts(0.75, 40), { key: 'badge.minutes', minutes: 45 });
  // exactly one workday is already a day
  assert.deepEqual(calc.badgeParts(8, 40), { key: 'badge.days', days: 1 });
  assert.deepEqual(calc.badgeParts(20, 40), { key: 'badge.days', days: 2.5 });
  assert.deepEqual(calc.badgeParts(7.99, 40), {
    key: 'badge.hoursMinutes',
    hours: 7,
    minutes: 59,
  });
  // ten days and over drop the decimal
  assert.deepEqual(calc.badgeParts(80, 40), { key: 'badge.days', days: 10 });
  assert.deepEqual(calc.badgeParts(100, 40), { key: 'badge.days', days: 13 });
  // a 20-hour week has a 4-hour workday, so the switch comes sooner
  assert.deepEqual(calc.badgeParts(5, 20), { key: 'badge.days', days: 1.3 });
  assert.deepEqual(calc.badgeParts(3.75, 20), {
    key: 'badge.hoursMinutes',
    hours: 3,
    minutes: 45,
  });
  // still a key, so it renders as '?' rather than as an empty badge
  assert.deepEqual(calc.badgeParts(NaN, 40), { key: 'badge.unknown' });
});

test('each framing threshold holds on both sides', () => {
  const week = 40;
  const workday = 8;

  const key = (hours, hoursPerWeek) => calc.framing(hours, hoursPerWeek).key;

  // < 0.10 workdays
  assert.equal(key(0.79, week), 'framing.coffeeBreak');
  // < 0.35
  assert.equal(key(0.8, week), 'framing.quickErrand');
  assert.equal(key(2.79, week), 'framing.quickErrand');
  // < 0.65
  assert.equal(key(2.8, week), 'framing.halfWorkday');
  assert.equal(key(5.19, week), 'framing.halfWorkday');
  // < 1.20
  assert.equal(key(5.2, week), 'framing.wholeWorkday');
  assert.equal(key(9.59, week), 'framing.wholeWorkday');
  // < 0.60 work weeks, and the number comes with the key
  assert.deepEqual(calc.framing(9.6, week), { key: 'framing.daysOfLife', days: 1.2 });
  assert.deepEqual(calc.framing(23.9, week), { key: 'framing.daysOfLife', days: 3 });
  // < 1.20 work weeks
  assert.equal(key(24, week), 'framing.wholeWorkWeek');
  assert.equal(key(47.9, week), 'framing.wholeWorkWeek');
  // beyond
  assert.deepEqual(calc.framing(48, week), { key: 'framing.workWeeks', weeks: 1.2 });
  assert.deepEqual(calc.framing(100, week), { key: 'framing.workWeeks', weeks: 2.5 });

  // the ladder is in workdays, so a 20-hour week moves every boundary
  assert.equal(key(0.79, 20), 'framing.quickErrand');
  assert.equal(key(2.8, 20), 'framing.wholeWorkday');
  assert.equal(calc.workdayHours(20), workday / 2);
});

test('framing refuses to guess without usable settings', () => {
  // null, not a key: there is nothing honest to say, and render() draws nothing.
  assert.equal(calc.framing(5, 0), null);
  assert.equal(calc.framing(NaN, 40), null);
  assert.equal(calc.framing(-1, 40), null);
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
  assert.deepEqual(calc.durationParts(time.totalHours), {
    key: 'time.hoursMinutes',
    hours: 7,
    minutes: 30,
  });
  assert.deepEqual(calc.badgeParts(time.totalHours, 40), {
    key: 'badge.hoursMinutes',
    hours: 7,
    minutes: 30,
  });
  assert.equal(calc.framing(time.totalHours, 40).key, 'framing.wholeWorkday');
});
