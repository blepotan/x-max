(function (root) {
  'use strict';

  const api = root.XMax || {};
  const MINUTE_MS = 60 * 1000;
  const MAX_NONEXISTENT_MINUTES = 2 * 24 * 60;

  function resolvedZone(zone) {
    if (zone && zone !== 'local') return zone;
    return typeof api.browserTimeZone === 'function' ? api.browserTimeZone() : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }

  function numericParts(date, zone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedZone(zone),
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const result = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== 'literal') result[part.type] = Number(part.value);
    }
    return {
      year: result.year,
      month: result.month,
      day: result.day,
      hour: result.hour,
      minute: result.minute,
      second: result.second
    };
  }

  function makeUtcTimestamp(fields) {
    const date = new Date(0);
    date.setUTCFullYear(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
    date.setUTCHours(Number(fields.hour || 0), Number(fields.minute || 0), Number(fields.second || 0), Number(fields.millisecond || 0));
    return date.getTime();
  }

  function utcParts(timestamp) {
    const date = new Date(timestamp);
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      millisecond: date.getUTCMilliseconds()
    };
  }

  function sameFields(left, right) {
    return left.year === right.year && left.month === right.month && left.day === right.day &&
      left.hour === right.hour && left.minute === right.minute && (left.second || 0) === (right.second || 0);
  }

  function validCivilDate(fields) {
    if (!Number.isInteger(fields.year) || !Number.isInteger(fields.month) || !Number.isInteger(fields.day) ||
        fields.month < 1 || fields.month > 12 || fields.day < 1 || fields.day > 31) return false;
    const timestamp = makeUtcTimestamp(Object.assign({}, fields, { hour: 0, minute: 0, second: 0 }));
    const normalized = utcParts(timestamp);
    return normalized.year === fields.year && normalized.month === fields.month && normalized.day === fields.day;
  }

  function addCivilMinutes(fields, minutes) {
    const timestamp = makeUtcTimestamp(Object.assign({}, fields, { second: 0, millisecond: 0 }));
    return utcParts(timestamp + minutes * MINUTE_MS);
  }

  function timezoneOffset(timestamp, zone) {
    const parts = numericParts(new Date(timestamp), zone);
    return makeUtcTimestamp(parts) - timestamp;
  }

  function candidateOffsets(naiveTimestamp, zone) {
    const offsets = new Set();
    // Intl supplies the rules. Sampling around the requested wall time catches both
    // sides of ordinary DST changes and date-line transitions without a rule table.
    const samples = [0, -6, 6, -12, 12, -24, 24, -48, 48, -72, 72].map((hours) => hours * 60 * 60 * 1000);
    for (const delta of samples) {
      try {
        offsets.add(timezoneOffset(naiveTimestamp + delta, zone));
      } catch (_error) {
        // Invalid zones are rejected by settings validation. Keep conversion fail-closed.
      }
    }
    return Array.from(offsets);
  }

  function matchingInstants(fields, zone) {
    if (!validCivilDate(fields)) return [];
    const naive = makeUtcTimestamp(fields);
    const matches = [];
    for (const offset of candidateOffsets(naive, zone)) {
      const timestamp = naive - offset;
      if (!Number.isFinite(timestamp)) continue;
      try {
        if (sameFields(numericParts(new Date(timestamp), zone), fields)) matches.push(timestamp);
      } catch (_error) {
        // Continue checking other offsets.
      }
    }
    return Array.from(new Set(matches)).sort((a, b) => a - b);
  }

  /**
   * Convert a local wall-clock value with Intl's IANA time-zone database.
   * Ambiguous values choose the earlier instant. Nonexistent values advance one
   * local minute at a time until Intl reports a valid instant.
   */
  function zonedFieldsToInstant(fields, zone) {
    const timeZone = resolvedZone(zone);
    let current = {
      year: Number(fields.year),
      month: Number(fields.month),
      day: Number(fields.day),
      hour: Number(fields.hour || 0),
      minute: Number(fields.minute || 0),
      second: Number(fields.second || 0)
    };
    if (!validCivilDate(current) || current.hour < 0 || current.hour > 23 || current.minute < 0 || current.minute > 59) {
      return { ok: false, code: 'INVALID_LOCAL_TIME' };
    }

    for (let adjustment = 0; adjustment <= MAX_NONEXISTENT_MINUTES; adjustment += 1) {
      const candidates = matchingInstants(current, timeZone);
      if (candidates.length > 0) {
        return {
          ok: true,
          timestamp: candidates[0],
          candidates: candidates,
          ambiguous: candidates.length > 1,
          adjusted: adjustment > 0,
          fields: current,
          requestedFields: fields,
          timeZone: timeZone
        };
      }
      current = addCivilMinutes(current, 1);
    }
    return { ok: false, code: 'INVALID_LOCAL_TIME', timeZone: timeZone };
  }

  function ceilToMinute(timestamp) {
    return Math.ceil(timestamp / MINUTE_MS) * MINUTE_MS;
  }

  function to12Hour(hour) {
    return { hour: ((hour + 11) % 12) + 1, period: hour >= 12 ? 'pm' : 'am' };
  }

  function computeFixedTarget(nowTimestamp, settings, zone) {
    const rawTarget = nowTimestamp + settings.delayMinutes * MINUTE_MS;
    const timestamp = ceilToMinute(rawTarget);
    return { timestamp: timestamp, adjusted: false, ambiguous: false };
  }

  function computeNextSlotAtOrAfter(thresholdTimestamp, intervalMinutes, zone) {
    const local = numericParts(new Date(thresholdTimestamp), zone);
    const remainder = (thresholdTimestamp % 1000 + 1000) % 1000;
    const fractionalMinutes = local.minute + (local.second * 1000 + remainder) / 60000;
    const minutesFromMidnight = Math.ceil((local.hour * 60 + fractionalMinutes) / intervalMinutes) * intervalMinutes;
    let wall = {
      year: local.year,
      month: local.month,
      day: local.day,
      hour: 0,
      minute: 0,
      second: 0
    };
    wall = addCivilMinutes(wall, minutesFromMidnight);

    // Usually the first conversion is enough. Around a fall-back transition the
    // earlier occurrence can precede the minimum lead threshold, so select the
    // later matching instant when necessary and otherwise move to the next slot.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const conversion = zonedFieldsToInstant(wall, zone);
      if (!conversion.ok) return conversion;
      const eligible = conversion.candidates.find((timestamp) => timestamp >= thresholdTimestamp);
      if (eligible !== undefined) {
        return {
          timestamp: eligible,
          adjusted: conversion.adjusted,
          ambiguous: conversion.ambiguous,
          requestedFields: conversion.requestedFields,
          fields: conversion.fields
        };
      }
      if (conversion.timestamp >= thresholdTimestamp) {
        return {
          timestamp: conversion.timestamp,
          adjusted: conversion.adjusted,
          ambiguous: conversion.ambiguous,
          requestedFields: conversion.requestedFields,
          fields: conversion.fields
        };
      }
      wall = addCivilMinutes(wall, intervalMinutes);
    }
    return { ok: false, code: 'TARGET_NOT_IN_FUTURE' };
  }

  function computeNextSlotTarget(nowTimestamp, settings, zone, latestScheduledTimestamp) {
    const minimumTimestamp = nowTimestamp + settings.minimumLeadMinutes * MINUTE_MS;
    const base = computeNextSlotAtOrAfter(minimumTimestamp, settings.slotIntervalMinutes, zone);
    if (!base || base.ok === false) return base;

    // A previously applied schedule is a local queue cursor. Add one
    // millisecond before rounding so a cursor exactly on a slot advances to
    // the following slot (2:30 -> 3:00 for a 30-minute interval).
    const cursor = Number(latestScheduledTimestamp);
    if (!Number.isFinite(cursor) || cursor <= 0) return base;
    const afterCursor = computeNextSlotAtOrAfter(cursor + 1, settings.slotIntervalMinutes, zone);
    if (!afterCursor || afterCursor.ok === false) return base;
    return afterCursor.timestamp > base.timestamp ? afterCursor : base;
  }

  function computeTarget(now, rawSettings, latestScheduledTimestamp) {
    const validation = typeof api.validateSettings === 'function' ? api.validateSettings(rawSettings) : { ok: true, settings: rawSettings };
    if (!validation.ok) return validation;
    const settings = validation.settings;
    const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
    if (!Number.isFinite(nowTimestamp)) return { ok: false, code: 'INVALID_CLOCK' };
    const zone = resolvedZone(settings.timezone);
    let result;
    try {
      result = settings.mode === 'next-slot'
        ? computeNextSlotTarget(nowTimestamp, settings, zone, latestScheduledTimestamp)
        : computeFixedTarget(nowTimestamp, settings, zone);
    } catch (_error) {
      return { ok: false, code: 'TIMEZONE_UNAVAILABLE', message: 'The configured time zone is unavailable.' };
    }
    if (!result || result.ok === false || !Number.isFinite(result.timestamp) || result.timestamp <= nowTimestamp) {
      return { ok: false, code: (result && result.code) || 'TARGET_NOT_IN_FUTURE' };
    }
    const targetDate = new Date(result.timestamp);
    // X's native scheduler has no time-zone control. Calculate the intended
    // instant using the configured rule zone, then write its equivalent wall
    // time in the browser zone that X displays.
    const inputTimeZone = resolvedZone('local');
    const wall = numericParts(targetDate, inputTimeZone);
    const twelve = to12Hour(wall.hour);
    return {
      ok: true,
      timestamp: result.timestamp,
      date: targetDate,
      timeZone: inputTimeZone,
      configuredTimeZone: zone,
      fields: wall,
      hour12: twelve.hour,
      period: twelve.period,
      adjusted: Boolean(result.adjusted),
      ambiguous: Boolean(result.ambiguous),
      mode: settings.mode,
      settings: settings
    };
  }

  function monthName(month) {
    return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(makeUtcTimestamp({ year: 2020, month: month, day: 1 })));
  }

  function formatTarget(target) {
    if (!target || !target.ok) return '';
    return formatTimestamp(target.timestamp, target.timeZone);
  }

  function formatTimestamp(timestamp, zone) {
    if (!Number.isFinite(Number(timestamp))) return '';
    const date = numericParts(new Date(Number(timestamp)), resolvedZone(zone));
    const twelve = to12Hour(date.hour);
    const minute = String(date.minute).padStart(2, '0');
    return `${monthName(date.month)} ${date.day}, ${date.year} at ${twelve.hour}:${minute} ${twelve.period.toUpperCase()}`;
  }

  function parseEnglishScheduleSummary(text, zone) {
    const match = String(text || '').match(/\bWill send\s+on\s+(?:[A-Za-z]{3,9},\s*)?([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
    if (!match) return null;
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const monthNameValue = match[1].toLowerCase();
    const month = months.findIndex((name) => name.startsWith(monthNameValue)) + 1;
    const day = Number(match[2]);
    const year = Number(match[3]);
    const hour12 = Number(match[4]);
    const minute = Number(match[5]);
    const period = match[6].toLowerCase();
    if (!month || !Number.isInteger(day) || !Number.isInteger(year) || hour12 < 1 || hour12 > 12 || minute > 59) return null;
    const hour = period === 'pm' ? (hour12 % 12) + 12 : hour12 % 12;
    const conversion = zonedFieldsToInstant({ year, month, day, hour, minute, second: 0 }, resolvedZone(zone));
    return conversion.ok ? conversion.timestamp : null;
  }

  api.MINUTE_MS = MINUTE_MS;
  api.resolvedZone = resolvedZone;
  api.getZonedParts = numericParts;
  api.zonedFieldsToInstant = zonedFieldsToInstant;
  api.computeTarget = computeTarget;
  api.formatTarget = formatTarget;
  api.formatTimestamp = formatTimestamp;
  api.parseEnglishScheduleSummary = parseEnglishScheduleSummary;
  api.to12Hour = to12Hour;
  root.XMax = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
