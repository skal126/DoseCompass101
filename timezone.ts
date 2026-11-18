import type { TimezoneSnapshot } from '../types/dispenser';

export const COMMON_TIMEZONES: string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getTimezoneSnapshot(
  timezone: string,
  date: Date = new Date(),
): TimezoneSnapshot {
  let safeTz = timezone || 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: safeTz });
  } catch {
    safeTz = 'UTC';
  }

  const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
  });

  const parts = partsFormatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = getPart('year') || '2026';
  const month = getPart('month') || '01';
  const day = getPart('day') || '01';
  const rawHour = getPart('hour') || '00';
  const hour = rawHour === '24' ? '00' : rawHour.padStart(2, '0');
  const minute = (getPart('minute') || '00').padStart(2, '0');
  const second = (getPart('second') || '00').padStart(2, '0');
  const weekdayShort = getPart('weekday') || 'Mon';
  const offsetLabel = getPart('timeZoneName') || 'GMT';

  const dateKey = `${year}-${month}-${day}`;
  const time24 = `${hour}:${minute}:${second}`;

  const hourNum = Number(hour);
  const period = hourNum >= 12 ? 'PM' : 'AM';
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
  const time12 = `${String(hour12).padStart(2, '0')}:${minute}:${second} ${period}`;

  const dateFormatted = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  return {
    ianaTimezone: safeTz,
    offsetLabel,
    dateKey,
    dateFormatted,
    time24,
    time12,
    dayOfWeek: WEEKDAY_MAP[weekdayShort] ?? 0,
    dayName: weekdayShort,
    unixSeconds: Math.floor(date.getTime() / 1000),
  };
}

export function formatTimeDisplay(hhmm: string, use24Hour: boolean): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const padM = String(m).padStart(2, '0');
  if (use24Hour) {
    return `${String(h).padStart(2, '0')}:${padM}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${padM} ${period}`;
}

export function addDaysToDateKey(dateKey: string, daysToAdd: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, (d || 1) + daysToAdd);
  const next = new Date(utc);
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function addMinutesToHHMM(hhmm: string, minutesToAdd: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (((h || 0) * 60 + (m || 0) + minutesToAdd) % 1440 + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

export function getSignedMinutesDelta(
  targetHHMM: string,
  snapshot: TimezoneSnapshot,
): number {
  const [th, tm] = targetHHMM.split(':').map(Number);
  const [ch, cm] = snapshot.time24.split(':').map(Number);
  const targetMinutes = (th || 0) * 60 + (tm || 0);
  const currentMinutes = (ch || 0) * 60 + (cm || 0);
  return targetMinutes - currentMinutes;
}

export function buildClockSyncCommand(
  timezone: string,
  date: Date = new Date(),
): { command: string; snapshot: TimezoneSnapshot } {
  const snapshot = getTimezoneSnapshot(timezone, date);
  const offsetMatch = snapshot.offsetLabel.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const sign = offsetMatch[1] === '-' ? -1 : 1;
    const hrs = Number(offsetMatch[2] || 0);
    const mins = Number(offsetMatch[3] || 0);
    offsetMinutes = sign * (hrs * 60 + mins);
  }
  const command = `T ${snapshot.unixSeconds} ${offsetMinutes}`;
  return { command, snapshot };
}
