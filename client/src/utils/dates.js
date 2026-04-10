export const APP_TIME_ZONE = 'Asia/Shanghai'; // UTC+8

export const isYmdLike = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);

const STRICT_YMD = /^\d{4}-\d{2}-\d{2}$/;

// Convert a Date (or date-like string) to YYYY-MM-DD in UTC+8 (Asia/Shanghai).
export const toYmd = (input, timeZone = APP_TIME_ZONE) => {
  if (typeof input === 'string' && STRICT_YMD.test(input.trim())) return input.trim();
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  // en-CA gives YYYY-MM-DD format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
};

// Parse YYYY-MM-DD to a Date object *in local environment* (used mainly for UI comparisons).
// Important: treat the string as a calendar date key; avoid using Date arithmetic for persistence.
export const parseYmd = (ymd) => {
  if (typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, monthIndex, day);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};

// Convert YYYY-MM-DD to an ISO string representing 00:00 at UTC+8.
export const ymdToIsoUtc8 = (ymd) => {
  if (typeof ymd !== 'string') return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(`${ymd}T00:00:00+08:00`).toISOString();
};

