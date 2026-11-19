// Turns money into time. Everything here is pure arithmetic over the user's
// settings, so the popup, the overlay and the test suite all share one source of
// truth for what a price costs in hours.
//
// A workday is hoursPerWeek / 5, a work week is hoursPerWeek and a work year is
// hoursPerWeek * 52, so every threshold and every label scales with how much the
// user actually works instead of assuming a 40-hour week.
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

  // Workdays in one work year. Derived, not written as 260: a work year is
  // hoursPerWeek * 52 hours and a workday is hoursPerWeek / 5, so the ratio is
  // 52 * 5 whatever the week is, and a 30-hour week reaches a year in fewer
  // hours while still reading as the same number of days.
  const WORKDAYS_PER_YEAR = WEEKS_PER_YEAR * WORKDAYS_PER_WEEK;

  /**
   * A span of work as whole years and whole workdays, or null below one work
   * year. Past that point a day count stops meaning anything -- '388d' is a
   * number, '1y128d' is a span someone can picture.
   *
   * The remaining days are rounded rather than truncated, so they agree with the
   * day count the same hours would have produced, and a remainder that rounds up
   * to a full year carries into the years rather than reading '1y260d'.
   */
  function yearParts(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    const week = Number(hoursPerWeek);
    const workday = workdayHours(week);
    if (!isFinite(hours) || hours < 0 || workday <= 0) return null;

    const yearHours = week * WEEKS_PER_YEAR;
    if (hours < yearHours) return null;

    let years = Math.floor(hours / yearHours);
    let days = Math.round((hours - years * yearHours) / workday);
    if (days >= WORKDAYS_PER_YEAR) {
      years += 1;
      days -= WORKDAYS_PER_YEAR;
    }
    return { years: years, days: days };
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
   * The compact form the overlay badge uses: "3h45m" within a workday, "2.5d"
   * once it passes one, and "1y23d" once it passes one work year.
   */
  function badgeParts(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    // A key like any other, so render() has something to render. Returning a
    // bare '?' here would come back from render() as an empty badge.
    if (!isFinite(hours) || hours < 0) return { key: 'badge.unknown' };

    const workday = workdayHours(hoursPerWeek);
    if (workday > 0 && hours >= workday) {
      // Past a work year, in years and whole days. An exact year drops the day
      // part rather than reading '2y0d'.
      const years = yearParts(hours, hoursPerWeek);
      if (years && years.days === 0) return { key: 'badge.years', years: years.years };
      if (years) return { key: 'badge.yearsDays', years: years.years, days: years.days };
      const days = hours / workday;
      return { key: 'badge.days', days: days < 10 ? round1(days) : Math.round(days) };
    }

    const split = splitHoursMinutes(hours);
    if (split.hours === 0) return { key: 'badge.minutes', minutes: split.minutes };
    if (split.minutes === 0) return { key: 'badge.hours', hours: split.hours };
    return { key: 'badge.hoursMinutes', hours: split.hours, minutes: split.minutes };
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
    const years = yearParts(hours, hoursPerWeek);
    if (years && years.days === 0) return { key: 'framing.yearsOfLife', years: years.years };
    if (years) {
      return { key: 'framing.yearsDaysOfLife', years: years.years, days: years.days };
    }
    return { key: 'framing.workWeeks', weeks: round1(hours / workweek) };
  }

  /**
   * The "+N days" label beside the bar: the work left over once the first
   * workday is full. It takes the same year form as everything else, on its own
   * terms -- the label says what is left, so a leftover of a work year or more
   * reads '+1y23d' however large the price itself is.
   */
  function overflowParts(overflowHours, hoursPerWeek) {
    const workday = workdayHours(hoursPerWeek);
    if (workday <= 0 || !isFinite(overflowHours) || overflowHours <= 0) return null;
    const years = yearParts(overflowHours, hoursPerWeek);
    if (years && years.days === 0) return { key: 'result.overflowYears', years: years.years };
    if (years) {
      return { key: 'result.overflowYearsDays', years: years.years, days: years.days };
    }
    return { key: 'result.overflowDays', days: round1(overflowHours / workday) };
  }

  /**
   * The eight-block workday bar. Each entry is how full that block is, 0 to 1,
   * so the popup can render a partial block. Anything past the first workday is
   * reported separately as `overflow`: a key and its numbers for the "+N days"
   * label beside the bar, null when the price fits inside one workday.
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

  root.WorthItCalc = {
    hourlyRate: hourlyRate,
    workdayHours: workdayHours,
    totalHoursFor: totalHoursFor,
    priceToTime: priceToTime,
    splitHoursMinutes: splitHoursMinutes,
    durationParts: durationParts,
    badgeParts: badgeParts,
    framing: framing,
    yearParts: yearParts,
    overflowParts: overflowParts,
    workdayBlocks: workdayBlocks,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItCalc;
}
