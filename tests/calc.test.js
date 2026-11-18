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

// A work year is hoursPerWeek * 52 hours: 2080 h at 40 h/week (8 h workdays),
// 1560 h at 30 h/week (6 h workdays).
test('a work year follows the hours-per-week setting', () => {
  assert.equal(calc.workYears(2072, 40), null, '259 workdays is still days');
  assert.deepEqual(calc.workYears(2080, 40), { years: 1, days: 0 });
  assert.deepEqual(calc.workYears(2088, 40), { years: 1, days: 1 });
  assert.deepEqual(calc.workYears(2264, 40), { years: 1, days: 23 });
  assert.deepEqual(calc.workYears(4160, 40), { years: 2, days: 0 });

  assert.equal(calc.workYears(1554, 30), null);
  assert.deepEqual(calc.workYears(1560, 30), { years: 1, days: 0 });
  assert.deepEqual(calc.workYears(1698, 30), { years: 1, days: 23 });
  // the same hours are a bigger share of a shorter work year
  assert.deepEqual(calc.workYears(2080, 30), { years: 1, days: 87 });
});

test('whole days that round up to a full year carry into the years', () => {
  // 259.5 workdays rounds to 260, which is one year, not "260d"
  assert.deepEqual(calc.workYears(2076, 40), { years: 1, days: 0 });
  // 519.5 rounds to 520: "2y", not "1y260d"
  assert.deepEqual(calc.workYears(4156, 40), { years: 2, days: 0 });
});

test('work years refuse to guess without usable settings', () => {
  assert.equal(calc.workYears(5000, 0), null);
  assert.equal(calc.workYears(NaN, 40), null);
  assert.equal(calc.workYears(-1, 40), null);
});

test('the badge, framing and overflow switch to years past one work year', () => {
  assert.deepEqual(calc.badgeParts(2072, 40), { key: 'badge.days', days: 259 });
  assert.deepEqual(calc.badgeParts(2080, 40), { key: 'badge.years', years: 1 });
  assert.deepEqual(calc.badgeParts(2264, 40), { key: 'badge.yearsDays', years: 1, days: 23 });
  assert.deepEqual(calc.badgeParts(4160, 40), { key: 'badge.years', years: 2 });
  assert.deepEqual(calc.badgeParts(1698, 30), { key: 'badge.yearsDays', years: 1, days: 23 });

  assert.equal(calc.framing(2072, 40).key, 'framing.workWeeks');
  assert.deepEqual(calc.framing(2080, 40), { key: 'framing.yearsOfLife', years: 1 });
  assert.deepEqual(calc.framing(2264, 40), { key: 'framing.yearsDaysOfLife', years: 1, days: 23 });

  // overflow is everything past the first workday, so it reaches a year one
  // workday later than the total does
  assert.equal(calc.workdayBlocks(4, 40).overflow, null);
  assert.deepEqual(calc.workdayBlocks(20, 40).overflow, { key: 'result.overflowDays', days: 1.5 });
  assert.deepEqual(calc.workdayBlocks(2080, 40).overflow, { key: 'result.overflowDays', days: 259 });
  assert.deepEqual(calc.workdayBlocks(2088, 40).overflow, { key: 'result.overflowYears', years: 1 });
  assert.deepEqual(calc.workdayBlocks(2264, 40).overflow, {
    key: 'result.overflowYearsDays',
    years: 1,
    days: 22,
  });
});

test('the workday bar degrades safely on bad input', () => {
  const empty = { filled: [0, 0, 0, 0, 0, 0, 0, 0], overflowDays: 0, overflow: null };
  assert.deepEqual(calc.workdayBlocks(5, 0), empty);
  assert.deepEqual(calc.workdayBlocks(NaN, 40), empty);
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
