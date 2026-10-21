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

  /** "3 h 45 min", "45 min", "3 h". */
  function formatHoursMinutes(totalHours) {
    const split = splitHoursMinutes(totalHours);
    if (split.hours === 0) return split.minutes + ' min';
    if (split.minutes === 0) return split.hours + ' h';
    return split.hours + ' h ' + split.minutes + ' min';
  }

  /**
   * The compact form the overlay badge uses: "3h45m" within a workday, "2.5d"
   * once it passes one.
   */
  function formatBadge(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    if (!isFinite(hours) || hours < 0) return '?';

    const workday = workdayHours(hoursPerWeek);
    if (workday > 0 && hours >= workday) {
      const days = hours / workday;
      return (days < 10 ? round1(days) : Math.round(days)) + 'd';
    }

    const split = splitHoursMinutes(hours);
    if (split.hours === 0) return split.minutes + 'm';
    if (split.minutes === 0) return split.hours + 'h';
    return split.hours + 'h' + split.minutes + 'm';
  }

  // The line under the headline figure. Thresholds are in workdays and work
  // weeks so they move with hoursPerWeek.
  const FRAMING = [
    { maxWorkdays: 0.1, line: 'A coffee break' },
    { maxWorkdays: 0.35, line: 'A quick errand' },
    { maxWorkdays: 0.65, line: 'Half your workday' },
    { maxWorkdays: 1.2, line: 'Your whole Tuesday' },
  ];

  /** A size-appropriate framing line, never a bare number. */
  function framing(totalHours, hoursPerWeek) {
    const hours = Number(totalHours);
    const workday = workdayHours(hoursPerWeek);
    const workweek = Number(hoursPerWeek);
    if (!isFinite(hours) || hours < 0 || workday <= 0) return '';

    for (let i = 0; i < FRAMING.length; i += 1) {
      if (hours < FRAMING[i].maxWorkdays * workday) return FRAMING[i].line;
    }
    if (hours < 0.6 * workweek) return round1(hours / workday) + ' days of your life';
    if (hours < 1.2 * workweek) return 'Your whole work week';
    return round1(hours / workweek) + ' work weeks';
  }

  /**
   * The eight-block workday bar. Each entry is how full that block is, 0 to 1,
   * so the popup can render a partial block. Anything past the first workday is
   * reported separately as overflowDays, to one decimal, for a "+N days" label.
   */
  function workdayBlocks(totalHours, hoursPerWeek) {
    const workday = workdayHours(hoursPerWeek);
    const hours = Number(totalHours);
    const filled = [];

    if (!isFinite(hours) || hours < 0 || workday <= 0) {
      for (let i = 0; i < BLOCKS_PER_WORKDAY; i += 1) filled.push(0);
      return { filled: filled, overflowDays: 0 };
    }

    const perBlock = workday / BLOCKS_PER_WORKDAY;
    let remaining = Math.min(hours, workday);
    for (let i = 0; i < BLOCKS_PER_WORKDAY; i += 1) {
      filled.push(Math.max(0, Math.min(1, remaining / perBlock)));
      remaining -= perBlock;
    }

    const overflowDays = hours > workday ? round1(hours / workday - 1) : 0;
    return { filled: filled, overflowDays: overflowDays };
  }

  root.WorthItCalc = {
    hourlyRate: hourlyRate,
    workdayHours: workdayHours,
    totalHoursFor: totalHoursFor,
    priceToTime: priceToTime,
    splitHoursMinutes: splitHoursMinutes,
    formatHoursMinutes: formatHoursMinutes,
    formatBadge: formatBadge,
    framing: framing,
    workdayBlocks: workdayBlocks,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItCalc;
}
