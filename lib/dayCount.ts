const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateOnly(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = DATE_RE.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

export function calculateDayCount(startDate?: string | null, todayDate?: string | null) {
  const start = parseDateOnly(startDate);
  const today = parseDateOnly(todayDate) ?? parseDateOnly(new Date().toISOString());

  if (start === null || today === null) {
    return null;
  }

  return Math.max(Math.floor((today - start) / DAY_MS) + 1, 1);
}

export function displayDayCount(dayCount?: number | null, startDate?: string | null, todayDate?: string | null) {
  const calculated = calculateDayCount(startDate, todayDate);
  const safeDayCount = typeof dayCount === 'number' && Number.isFinite(dayCount) && dayCount > 0 ? dayCount : calculated;
  return safeDayCount ? `D+${safeDayCount}` : null;
}
