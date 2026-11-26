// Turns money into time. Everything here is pure arithmetic over the user's
// settings, so the popup, the overlay and the test suite all share one source of
// truth for what a price costs in hours.
//
// A workday is hoursPerWeek / 5 and a work week is hoursPerWeek, so every
// threshold and every label scales with how much the user actually works instead
// of assuming a 40-hour week.
(function (root) {
  'use strict';

  const WEEKS_PER_YEAR = 52;
  const MONTHS_PER_YEAR = 12;
  const WORKDAYS_PER_WEEK = 5;
  const BLOCKS_PER_WORKDAY = 8;

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  /** Hours in one workday, 8 at the default 40-hour week. */
  function workdayHours(hoursPerWeek) {
    const week = Number(hoursPerWeek);
    if (!isFinite(week) || week <= 0) return 0;
    return week / WORKDAYS_PER_WEEK;
  }

  /**
   * The user's after-tax hourly rate.
   * A monthly salary becomes hourly through monthly / (hours_per_week * 52 / 12).
   * Returns 0 when the settings cannot produce a usable rate, so callers can
   * refuse to show a number rather than divide by zero.
   */
  function hourlyRate(settings) {
    const config = settings || {};
    const hoursPerWeek = Number(config.hoursPerWeek);

    if (config.incomeMode === 'hourly') {
      const rate = Number(config.hourly);
      return isFinite(rate) && rate > 0 ? rate : 0;
    }

    const monthly = Number(config.monthly);
    if (!isFinite(monthly) || monthly <= 0) return 0;
    if (!isFinite(hoursPerWeek) || hoursPerWeek <= 0) return 0;

    const monthlyHours = (hoursPerWeek * WEEKS_PER_YEAR) / MONTHS_PER_YEAR;
    return monthly / monthlyHours;
  }

  /** Hours of work a home-currency amount costs, or null when the rate is unusable. */
  function totalHoursFor(amountHome, rate) {
    const amount = Number(amountHome);
    const hourly = Number(rate);
    if (!isFinite(amount) || amount < 0) return null;
    if (!isFinite(hourly) || hourly <= 0) return null;
    return amount / hourly;
  }

  /**
   * Splits hours into whole hours and minutes. Minutes are rounded, not
   * truncated, and a rounded 60 carries into the hour so nothing ever reads
   * "2 h 60 min".
   */
  function splitHoursMinutes(totalHours) {
    const hours = Number(totalHours);
    if (!isFinite(hours) || hours < 0) return { hours: 0, minutes: 0 };
    let whole = Math.floor(hours);
    let minutes = Math.round((hours - whole) * 60);
    if (minutes === 60) {
      whole += 1;
      minutes = 0;
    }
    return { hours: whole, minutes: minutes };
  }

  /** The popup's headline figure. */
  function priceToTime(amountHome, rate) {
    const totalHours = totalHoursFor(amountHome, rate);
    if (totalHours === null) return null;
    const split = splitHoursMinutes(totalHours);
    return { hours: split.hours, minutes: split.minutes, totalHours: totalHours };
  }

  /**
   * The long form, as a key and its numbers: "3 h 45 min", "45 min", "3 h".
   *
   * Everything below returns a key rather than a sentence. The wording lives in
   * lib/i18n.js, so this file stays pure arithmetic and a new language needs no
   * change here -- not even for the units, which read "tim" in Swedish.
   */
  function durationParts(totalHours) {
    const split = splitHoursMinutes(totalHours);
    if (split.hours === 0) return { key: 'time.minutes', minutes: split.minutes };
    if (split.minutes === 0) return { key: 'time.hours', hours: split.hours };
    return { key: 'time.hoursMinutes', hours: split.hours, minutes: split.minutes };
  }

  /**
   * Splits hours into whole work years and the whole workdays left over, or
   * null below one work year. A work year is hoursPerWeek * WEEKS_PER_YEAR
   * hours, so where it starts moves with the user's settings. Days are counted
   * and rounded first, so a remainder that rounds up to a full year carries into
   * the years rather than reading "1y260d".
   */
  function workYears(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    const workday = workdayHours(hoursPerWeek);
    if (!isFinite(hours) || hours < 0 || workday <= 0) return null;

    const yearHours = Number(hoursPerWeek) * WEEKS_PER_YEAR;
    const workdaysPerYear = Math.round(yearHours / workday);
    const totalDays = Math.round(hours / workday);
    if (totalDays < workdaysPerYear) return null;

    const years = Math.floor(totalDays / workdaysPerYear);
    return { years: years, days: totalDays - years * workdaysPerYear };
  }

  /**
   * The compact form the overlay badge uses: "3h45m" within a workday, "2.5d"
   * once it passes one, "1y23d" once it passes a work year.
   */
  function badgeParts(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    // A key like any other, so render() has something to render. Returning a
    // bare '?' here would come back from render() as an empty badge.
    if (!isFinite(hours) || hours < 0) return { key: 'badge.unknown' };

    const span = workYears(hours, hoursPerWeek);
    if (span) {
      if (span.days === 0) return { key: 'badge.years', years: span.years };
      return { key: 'badge.yearsDays', years: span.years, days: span.days };
    }

    const workday = workdayHours(hoursPerWeek);
    if (workday > 0 && hours >= workday) {
      const days = hours / workday;
      return { key: 'badge.days', days: days < 10 ? round1(days) : Math.round(days) };
    }

    const split = splitHoursMinutes(hours);
    if (split.hours === 0) return { key: 'badge.minutes', minutes: split.minutes };
    if (split.minutes === 0) return { key: 'badge.hours', hours: split.hours };
    return { key: 'badge.hoursMinutes', hours: split.hours, minutes: split.minutes };
  }

  /**
   * The long-form duration, scaled the way badgeParts is: the popup's main
   * result used to read "1234 h 30 min" however big the number, while the badge
   * beside the same price said "2y14d".
   *
   * Same thresholds as badgeParts, and the same hoursPerWeek, so the two can
   * never disagree about which scale a price is on. The wording is the long one
   * -- "3 days 3 h", not "3.4d" -- so days are split into whole days and the
   * hours left over rather than carrying a decimal, and a unit that comes out
   * zero is left off entirely ("1 day", not "1 day 0 h").
   *
   * Singular and plural are two different keys, chosen here, because deciding
   * between them is arithmetic and lib/i18n.js only renders what it is handed.
   */
  function longDurationParts(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    if (!isFinite(hours) || hours < 0) return durationParts(totalHours);

    const years = workYears(hours, hoursPerWeek);
    if (years) {
      const yearPart = countOf('time.year', 'years', years.years);
      if (years.days === 0) return yearPart;
      return compound(yearPart, countOf('time.day', 'days', years.days));
    }

    const workday = workdayHours(hoursPerWeek);
    if (workday > 0 && hours >= workday) {
      const whole = Math.floor(hours / workday);
      const dayPart = countOf('time.day', 'days', whole);
      // Whole hours only at this scale: minutes are noise beside a day, and the
      // badge has already rounded harder than this.
      const rest = splitHoursMinutes(hours - whole * workday).hours;
      if (rest === 0) return dayPart;
      return compound(dayPart, { key: 'time.hours', hours: rest });
    }

    return durationParts(hours);
  }

  /** One count and its unit, picking the singular or plural key. */
  function countOf(stem, plural, count) {
    const parts = {};
    parts.key = count === 1 ? stem : `${stem}s`;
    parts[plural] = count;
    return parts;
  }

  /** Two rendered parts side by side; lib/i18n.js joins them per language. */
  function compound(first, second) {
    return { key: 'time.compound', first: first, second: second };
  }

  // The line under the headline figure. Thresholds are in workdays and work
  // weeks so they move with hoursPerWeek.
  const FRAMING = [
    { maxWorkdays: 0.1, key: 'framing.coffeeBreak' },
    { maxWorkdays: 0.35, key: 'framing.quickErrand' },
    { maxWorkdays: 0.65, key: 'framing.halfWorkday' },
    { maxWorkdays: 1.2, key: 'framing.wholeWorkday' },
  ];

  /**
   * A size-appropriate framing line, as a key and its numbers, never a bare
   * number. null when the settings cannot support a line at all, so the caller
   * renders nothing rather than guessing.
   */
  function framing(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    const workday = workdayHours(hoursPerWeek);
    const workweek = Number(hoursPerWeek);
    if (!isFinite(hours) || hours < 0 || workday <= 0) return null;

    for (let i = 0; i < FRAMING.length; i += 1) {
      if (hours < FRAMING[i].maxWorkdays * workday) return { key: FRAMING[i].key };
    }
    if (hours < 0.6 * workweek) {
      return { key: 'framing.daysOfLife', days: round1(hours / workday) };
    }
    if (hours < 1.2 * workweek) return { key: 'framing.wholeWorkWeek' };
    const span = workYears(hours, hoursPerWeek);
    if (span) {
      if (span.days === 0) return { key: 'framing.yearsOfLife', years: span.years };
      return { key: 'framing.yearsDaysOfLife', years: span.years, days: span.days };
    }
    return { key: 'framing.workWeeks', weeks: round1(hours / workweek) };
  }

  /**
   * The eight-block workday bar. Each entry is how full that block is, 0 to 1,
   * so the popup can render a partial block. Anything past the first workday is
   * reported separately as `overflow`: the key and numbers for the label beside
   * the bar -- "+N days", or "+1y23d" once the leftover itself passes a work
   * year -- and null when the price fits inside one workday. A key rather than
   * a bare number, like everything else here, so the wording stays in
   * lib/i18n.js.
   */
  function workdayBlocks(totalHours, hoursPerWeek) {
    const workday = workdayHours(hoursPerWeek);
    const hours = Number(totalHours);
    const filled = [];

    if (!isFinite(hours) || hours < 0 || workday <= 0) {
      for (let i = 0; i < BLOCKS_PER_WORKDAY; i += 1) filled.push(0);
      return { filled: filled, overflow: null };
    }

    const perBlock = workday / BLOCKS_PER_WORKDAY;
    let remaining = Math.min(hours, workday);
    for (let i = 0; i < BLOCKS_PER_WORKDAY; i += 1) {
      filled.push(Math.max(0, Math.min(1, remaining / perBlock)));
      remaining -= perBlock;
    }

    return { filled: filled, overflow: overflowParts(hours - workday, hoursPerWeek) };
  }

  /** The label beside the bar, for the work left over past the first workday. */
  function overflowParts(overflowHours, hoursPerWeek) {
    const workday = workdayHours(hoursPerWeek);
    if (workday <= 0 || !isFinite(overflowHours) || overflowHours <= 0) return null;
    const span = workYears(overflowHours, hoursPerWeek);
    if (span) {
      if (span.days === 0) return { key: 'result.overflowYears', years: span.years };
      return { key: 'result.overflowYearsDays', years: span.years, days: span.days };
    }
    return { key: 'result.overflowDays', days: round1(overflowHours / workday) };
  }

  root.WorthItCalc = {
    hourlyRate: hourlyRate,
    workdayHours: workdayHours,
    workYears: workYears,
    totalHoursFor: totalHoursFor,
    priceToTime: priceToTime,
    splitHoursMinutes: splitHoursMinutes,
    durationParts: durationParts,
    longDurationParts: longDurationParts,
    badgeParts: badgeParts,
    framing: framing,
    workdayBlocks: workdayBlocks,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItCalc;
}
