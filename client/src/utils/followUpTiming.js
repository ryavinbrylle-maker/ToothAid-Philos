/** Follow-up timing set on visits when requiresFollowUp is true. */

import { toYmd, parseYmd } from './dates';

export const FOLLOW_UP_WITHIN_7_DAYS = 'WITHIN_7_DAYS';
export const FOLLOW_UP_WITHIN_14_DAYS = 'WITHIN_14_DAYS'; // legacy stored visits only
export const FOLLOW_UP_WHENEVER = 'WHENEVER';
export const FOLLOW_UP_CUSTOM_DAYS = 'CUSTOM_DAYS';

export const FOLLOW_UP_TIMING_VALUES = [
  FOLLOW_UP_WITHIN_7_DAYS,
  FOLLOW_UP_WITHIN_14_DAYS,
  FOLLOW_UP_WHENEVER,
  FOLLOW_UP_CUSTOM_DAYS
];

/** Options shown on the Add/Edit Visit form. */
export const FOLLOW_UP_FORM_OPTIONS = [
  { value: FOLLOW_UP_WITHIN_7_DAYS, label: 'In 7 days' },
  { value: FOLLOW_UP_WHENEVER, label: 'Whenever convenient' },
  { value: FOLLOW_UP_CUSTOM_DAYS, label: 'Custom number of days' }
];

/** @deprecated Use FOLLOW_UP_FORM_OPTIONS */
export const FOLLOW_UP_TIMING_OPTIONS = FOLLOW_UP_FORM_OPTIONS;

/** Normalize stored value; maps legacy P0–P3 to new windows. */
export function normalizeFollowUpTiming(raw) {
  const s = String(raw ?? '').trim();
  if (FOLLOW_UP_TIMING_VALUES.includes(s)) return s;
  if (s === 'P0' || s === 'P1') return FOLLOW_UP_WITHIN_7_DAYS;
  if (s === 'P2') return FOLLOW_UP_WITHIN_14_DAYS;
  if (s === 'P3') return FOLLOW_UP_WHENEVER;
  return FOLLOW_UP_WITHIN_7_DAYS;
}

export function resolveFollowUpDays(timing, followUpDaysRaw) {
  const t = normalizeFollowUpTiming(timing);
  if (t === FOLLOW_UP_WHENEVER) return null;
  if (t === FOLLOW_UP_WITHIN_7_DAYS) return 7;
  if (t === FOLLOW_UP_WITHIN_14_DAYS) return 14;
  if (t === FOLLOW_UP_CUSTOM_DAYS) {
    const n = Number(followUpDaysRaw);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 14;
  }
  return 7;
}

/** Sort order: day count (asc) → whenever → no follow-up (caller uses 10000). */
export const FOLLOW_UP_SORT_RANK_WHENEVER = 9999;
export const FOLLOW_UP_SORT_RANK_NONE = 10000;

export function followUpSortRank(timing, followUpDaysRaw) {
  const t = normalizeFollowUpTiming(timing);
  if (t === FOLLOW_UP_WHENEVER) return FOLLOW_UP_SORT_RANK_WHENEVER;
  return resolveFollowUpDays(t, followUpDaysRaw);
}

export function getFollowUpTimingLabel(timing, followUpDaysRaw) {
  const t = normalizeFollowUpTiming(timing);
  if (t === FOLLOW_UP_WHENEVER) return 'Whenever convenient';
  if (t === FOLLOW_UP_WITHIN_7_DAYS) return 'In 7 days';
  const days = resolveFollowUpDays(t, followUpDaysRaw);
  return `In ${days} days`;
}

export function isUrgentFollowUpTiming(timing, followUpDaysRaw) {
  return resolveFollowUpDays(timing, followUpDaysRaw) === 7;
}

/** Calendar due date for display (MM/DD/YYYY in app timezone); null if none. */
export function formatFollowUpDueAt(dueAtIso) {
  if (dueAtIso == null || String(dueAtIso).trim() === '') return null;
  const ymd = toYmd(dueAtIso);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-');
  return `${m}/${d}/${y}`;
}

/** Whole calendar days from today (app TZ) until follow-up due; negative if overdue. */
export function daysUntilFollowUpDue(dueAtIso, todayInput = new Date()) {
  const dueYmd = toYmd(dueAtIso);
  const todayYmd = toYmd(todayInput);
  if (!dueYmd || !todayYmd) return null;
  const due = parseYmd(dueYmd);
  const today = parseYmd(todayYmd);
  if (!due || !today) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((due.getTime() - today.getTime()) / msPerDay);
}

/** Short countdown for patient list, e.g. "in 5 days" or "Due today". */
export function getFollowUpDueCountdownLabel(dueAtIso, todayInput = new Date()) {
  const n = daysUntilFollowUpDue(dueAtIso, todayInput);
  if (n == null) return null;
  if (n === 0) return 'Due today';
  if (n === 1) return 'in 1 day';
  if (n > 1) return `in ${n} days`;
  if (n === -1) return '1 day overdue';
  return `${Math.abs(n)} days overdue`;
}

/** Due date from visit date + window; null for whenever. */
export function computeFollowUpDueAt(visitDate, timing, followUpDaysRaw) {
  const days = resolveFollowUpDays(timing, followUpDaysRaw);
  const base = visitDate ? new Date(visitDate) : null;
  if (!base || Number.isNaN(base.getTime()) || days == null) return null;
  const due = new Date(base);
  due.setDate(due.getDate() + days);
  return due.toISOString();
}

/** Map stored visit follow-up fields to Add/Edit Visit form state. */
export function visitFollowUpToForm(priority, followUpDaysRaw) {
  const t = normalizeFollowUpTiming(priority);
  if (t === FOLLOW_UP_WITHIN_14_DAYS) {
    return { priority: FOLLOW_UP_CUSTOM_DAYS, customDays: '14' };
  }
  if (t === FOLLOW_UP_CUSTOM_DAYS) {
    return {
      priority: FOLLOW_UP_CUSTOM_DAYS,
      customDays: String(resolveFollowUpDays(t, followUpDaysRaw))
    };
  }
  return { priority: t, customDays: '14' };
}

export function visitRequiresFollowUp(v) {
  return Boolean(v?.childId && v?.visitId && (v.requiresFollowUp === true || v.requiresFollowUp === 'true'));
}

/** Latest visit per child that still requires a follow-up appointment. */
export function buildLatestFollowUpByChild(visits) {
  const map = new Map();
  if (!Array.isArray(visits)) return map;
  for (const v of visits) {
    if (!visitRequiresFollowUp(v)) continue;
    const childId = v.childId;
    const ts = new Date(v.updatedAt || v.createdAt || v.date || 0).getTime();
    const cur = map.get(childId);
    if (!cur || ts > cur.ts) {
      const timing = normalizeFollowUpTiming(v.followUpPriority);
      const followUpDays =
        timing === FOLLOW_UP_CUSTOM_DAYS ? resolveFollowUpDays(timing, v.followUpDays) : null;
      map.set(childId, {
        ts,
        timing,
        followUpDays,
        dueAt:
          v.followUpDueAt != null && String(v.followUpDueAt).trim() !== ''
            ? new Date(v.followUpDueAt).toISOString()
            : computeFollowUpDueAt(v.date, timing, followUpDays),
        visitId: v.visitId
      });
    }
  }
  return map;
}

export function isValidFollowUpTiming(value) {
  return FOLLOW_UP_TIMING_VALUES.includes(String(value ?? '').trim());
}
