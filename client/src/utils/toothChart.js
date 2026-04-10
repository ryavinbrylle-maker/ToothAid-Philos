export const CONDITIONS = [
  { id: 'sound', label: 'Sound', color: '#E5E7EB' },
  { id: 'decayed', label: 'Decayed', color: '#EF4444' },
  { id: 'missing', label: 'Missing', color: '#6B7280' },
  { id: 'filled', label: 'Filled', color: '#3B82F6' },
  { id: 'fractured', label: 'Fractured', color: '#F97316' },
  { id: 'sealant', label: 'Sealant', color: '#10B981' }
];

export const permanentTeeth = [
  ['18', '17', '16', '15', '14', '13', '12', '11'],
  ['21', '22', '23', '24', '25', '26', '27', '28'],
  ['48', '47', '46', '45', '44', '43', '42', '41'],
  ['31', '32', '33', '34', '35', '36', '37', '38']
];

export const primaryTeeth = [
  ['55', '54', '53', '52', '51'],
  ['61', '62', '63', '64', '65'],
  ['85', '84', '83', '82', '81'],
  ['71', '72', '73', '74', '75']
];

export const PERMANENT_SET = new Set(permanentTeeth.flat());
export const PRIMARY_SET = new Set(primaryTeeth.flat());

export const isDarkHex = (hex) => {
  if (typeof hex !== 'string') return false;
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 140;
};

/** Baseline from patient `toothStates` (same as Visit Entry picker). */
export function getPersistedToothCondition(toothStates, tooth) {
  if (toothStates == null || typeof toothStates !== 'object') return 'sound';
  const raw = toothStates[tooth];
  if (raw == null) return 'sound';
  let c = null;
  if (typeof raw === 'string') c = raw;
  else if (typeof raw === 'object' && raw.condition != null) c = String(raw.condition);
  if (!c || !CONDITIONS.some((x) => x.id === c)) return 'sound';
  return c;
}

export function normalizeConditionId(c) {
  if (c == null || c === '') return 'sound';
  const s = String(c);
  return CONDITIONS.some((x) => x.id === s) ? s : 'sound';
}

const fdiToothCompare = (a, b) => {
  const na = parseInt(String(a), 10);
  const nb = parseInt(String(b), 10);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a) === String(na) && String(b) === String(nb)) {
    return na - nb;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/** One row per examined tooth for visit history (toothExaminations preferred, else toothRecords). */
export function buildVisitTeethRows(visit) {
  if (Array.isArray(visit?.toothExaminations) && visit.toothExaminations.length > 0) {
    const rows = visit.toothExaminations
      .filter((e) => e && e.toothNumber != null && e.toothNumber !== '')
      .map((e) => {
        const tooth = String(e.toothNumber);
        let conditionRaw = e.condition;
        const tr = visit?.toothRecords?.[tooth];
        if (conditionRaw == null || conditionRaw === '') {
          if (tr && typeof tr === 'object' && tr.condition != null) conditionRaw = tr.condition;
          else if (typeof tr === 'string') conditionRaw = tr;
        }
        let note = e.note != null && String(e.note).trim() !== '' ? String(e.note).trim() : null;
        if (!note && tr && typeof tr === 'object' && tr.note != null && String(tr.note).trim() !== '') {
          note = String(tr.note).trim();
        }
        const treatments = Array.isArray(e.treatments)
          ? e.treatments.filter((t) => t != null && String(t).trim() !== '')
          : [];
        return {
          tooth,
          conditionId: normalizeConditionId(conditionRaw),
          note,
          treatments
        };
      });
    rows.sort((x, y) => fdiToothCompare(x.tooth, y.tooth));
    return rows;
  }

  const tr = visit?.toothRecords;
  if (tr && typeof tr === 'object') {
    const rows = Object.keys(tr)
      .filter((k) => k != null && k !== '')
      .map((key) => {
        const tooth = String(key);
        const raw = tr[tooth];
        let conditionId = 'sound';
        let note = null;
        if (raw != null && typeof raw === 'object') {
          conditionId = normalizeConditionId(raw.condition);
          if (raw.note != null && String(raw.note).trim() !== '') note = String(raw.note).trim();
        } else if (typeof raw === 'string') {
          conditionId = normalizeConditionId(raw);
        }
        return { tooth, conditionId, note, treatments: [] };
      });
    rows.sort((x, y) => fdiToothCompare(x.tooth, y.tooth));
    return rows;
  }

  return [];
}
