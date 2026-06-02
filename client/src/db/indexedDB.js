import Dexie from 'dexie';
import { API_BASE_URL, getApiPath } from '../config';
import { toYmd } from '../utils/dates';

const db = new Dexie('ToothAidDB');

/** True when pull payload has no meaningful value (legacy rows / partial JSON / empty containers). */
function isServerPayloadValueEmpty(v, opts = {}) {
  const { treatBlankStringAsEmpty = false } = opts;
  if (v === undefined || v === null) return true;
  if (treatBlankStringAsEmpty && typeof v === 'string' && v.trim() === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'object' && !Array.isArray(v) && v && Object.keys(v).length === 0) return true;
  return false;
}

function localHasMergeableValue(lv, opts = {}) {
  const { treatBlankStringAsEmpty = false } = opts;
  if (lv === undefined || lv === null) return false;
  if (treatBlankStringAsEmpty && typeof lv === 'string' && lv.trim() === '') return false;
  if (Array.isArray(lv) && lv.length === 0) return false;
  if (typeof lv === 'object' && !Array.isArray(lv) && lv && Object.keys(lv).length === 0) return false;
  return true;
}

/** Pull must not wipe AM/PM when server rows are legacy (null) or JSON omits fields. */
function mergeClinicDayRowFromPull(serverRow, local) {
  const { _id, __v, ...rest } = serverRow;
  const merged = { ...(local || {}), ...rest };
  if (merged.date != null) merged.date = toYmd(merged.date);
  const sAm = rest.amCapacity;
  const sPm = rest.pmCapacity;
  merged.amCapacity =
    typeof sAm === 'number' && !Number.isNaN(sAm) ? sAm : local?.amCapacity ?? null;
  merged.pmCapacity =
    typeof sPm === 'number' && !Number.isNaN(sPm) ? sPm : local?.pmCapacity ?? null;
  merged.capacity =
    typeof rest.capacity === 'number' && !Number.isNaN(rest.capacity)
      ? rest.capacity
      : (merged.amCapacity ?? 0) + (merged.pmCapacity ?? 0);
  return merged;
}

/** Pull must not wipe meds / tooth charts when server omits a field or stores null (legacy). */
function mergeVisitRowFromPull(serverRow, local) {
  const { _id, __v, ...rest } = serverRow || {};
  const merged = { ...(local || {}), ...rest };

  const restoreIfServerMissingOrEmpty = (key, opts) => {
    if (!isServerPayloadValueEmpty(rest[key], opts)) return;
    if (localHasMergeableValue(local?.[key], opts)) merged[key] = local[key];
  };

  // These are client-authored, and older servers may drop them.
  restoreIfServerMissingOrEmpty('medications');
  restoreIfServerMissingOrEmpty('treatments');
  restoreIfServerMissingOrEmpty('toothExaminations');
  restoreIfServerMissingOrEmpty('toothRecords');
  restoreIfServerMissingOrEmpty('symptoms');
  restoreIfServerMissingOrEmpty('examinationNotes', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('toothSpecificTreatments');
  restoreIfServerMissingOrEmpty('treatmentTypes');
  restoreIfServerMissingOrEmpty('chiefComplaint', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('notes', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('behaviourFrankl');
  restoreIfServerMissingOrEmpty('requiresFollowUp');
  restoreIfServerMissingOrEmpty('followUpPriority', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('followUpDays');
  restoreIfServerMissingOrEmpty('followUpDueAt');
  if (rest.dentition === undefined || rest.dentition === null) {
    if (local?.dentition != null) merged.dentition = local.dentition;
  }

  return merged;
}

/** Same class of pull overwrite issue as visits — preserve rich local fields when server row is empty. */
function mergeChildRowFromPull(serverRow, local) {
  const { _id, __v, ...rest } = serverRow || {};
  const merged = { ...(local || {}), ...rest };

  const restoreIfServerMissingOrEmpty = (key, opts) => {
    if (!isServerPayloadValueEmpty(rest[key], opts)) return;
    if (localHasMergeableValue(local?.[key], opts)) merged[key] = local[key];
  };

  restoreIfServerMissingOrEmpty('toothStates');
  restoreIfServerMissingOrEmpty('consentSpecific');
  restoreIfServerMissingOrEmpty('patientId', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('notes', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('medicalCondition');
  restoreIfServerMissingOrEmpty('guardianName', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('relationship', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('address', { treatBlankStringAsEmpty: true });

  return merged;
}

/**
 * Appointments: same overwrite risk when pull rows are partial / legacy.
 * Do not restore primary keys (appointmentId, childId, clinicDayId) — server is source of truth for those.
 */
function mergeAppointmentRowFromPull(serverRow, local) {
  const { _id, __v, ...rest } = serverRow || {};
  const merged = { ...(local || {}), ...rest };

  const restoreIfServerMissingOrEmpty = (key, opts) => {
    if (!isServerPayloadValueEmpty(rest[key], opts)) return;
    if (localHasMergeableValue(local?.[key], opts)) merged[key] = local[key];
  };

  restoreIfServerMissingOrEmpty('timeWindow', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('slotNumber');
  restoreIfServerMissingOrEmpty('reason', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('status', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('priorityTier');
  restoreIfServerMissingOrEmpty('order');
  restoreIfServerMissingOrEmpty('priority', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('note', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('procedureType', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('createdBy', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('statusChangedAt');
  restoreIfServerMissingOrEmpty('statusChangedBy', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('statusReason', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('followUpNeeded');
  restoreIfServerMissingOrEmpty('followUpDueAt');
  restoreIfServerMissingOrEmpty('followUps');
  restoreIfServerMissingOrEmpty('contactLogs');
  restoreIfServerMissingOrEmpty('rescheduledFromAppointmentId', { treatBlankStringAsEmpty: true });
  restoreIfServerMissingOrEmpty('rescheduledToAppointmentId', { treatBlankStringAsEmpty: true });
  // Reserved for future client / server extensions
  restoreIfServerMissingOrEmpty('metadata');
  restoreIfServerMissingOrEmpty('notes', { treatBlankStringAsEmpty: true });

  return merged;
}

db.version(25).stores({
  children: 'childId, patientId, fullName, school, barangay, updatedAt',
  visits: 'visitId, childId, date, createdAt',
  outbox: 'opId, ts, action, entityId',
  meta: 'key',
  clinicDays: 'clinicDayId, date, school, createdAt',
  appointments: 'appointmentId, childId, clinicDayId, status, createdAt'
});

// Helper to get/set metadata
export const getMeta = async (key) => {
  const record = await db.meta.get(key);
  return record ? record.value : null;
};

export const setMeta = async (key, value) => {
  await db.meta.put({ key, value });
};

// Get device ID
export const getDeviceId = async () => {
  let deviceId = await getMeta('deviceId');
  if (!deviceId) {
    deviceId = `device-${crypto.randomUUID()}`;
    await setMeta('deviceId', deviceId);
  }
  return deviceId;
};

// Get last sync time
export const getLastSyncAt = async () => {
  return await getMeta('lastSyncAt');
};

export const setLastSyncAt = async (timestamp) => {
  await setMeta('lastSyncAt', timestamp);
};

// Outbox operations
export const addToOutbox = async (action, entityId, payload) => {
  const opId = crypto.randomUUID();
  const deviceId = await getDeviceId();
  const op = {
    opId,
    deviceId,
    ts: new Date().toISOString(),
    action,
    entityId,
    payload
  };
  await db.outbox.add(op);
  return op;
};

export const getOutboxOps = async () => {
  return await db.outbox.toArray();
};

export const removeFromOutbox = async (opIds) => {
  await db.outbox.bulkDelete(opIds);
};

// Sort key for last name (supports legacy fullName-only data)
const getLastName = (c) => (c.lastName != null && c.lastName !== '') ? c.lastName : (c.fullName || '').trim().split(/\s+/).pop() || '';
const getFirstName = (c) => (c.firstName != null && c.firstName !== '') ? c.firstName : (c.fullName || '').trim().split(/\s+/).slice(0, -1).join(' ') || '';
const compareChildrenByLastName = (a, b) => {
  const ln = getLastName(a).localeCompare(getLastName(b), undefined, { sensitivity: 'base' });
  if (ln !== 0) return ln;
  return getFirstName(a).localeCompare(getFirstName(b), undefined, { sensitivity: 'base' });
};

export const sortChildrenByLastName = (children) => {
  return [...children].sort(compareChildrenByLastName);
};

const normalizeSearchText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenizeSearchText = (value) => normalizeSearchText(value).split(/\s+/).filter(Boolean);

const getSearchCandidates = (child) => {
  const firstName = getFirstName(child).trim();
  const lastName = getLastName(child).trim();
  const firstLast = [firstName, lastName].filter(Boolean).join(' ');
  const lastFirst = [lastName, firstName].filter(Boolean).join(' ');
  const weightedValues = [
    [child.fullName, 90],
    [firstLast, 95],
    [lastFirst, 100],
    [firstName, 80],
    [lastName, 80],
    [child.school, 55],
    [child.grade, 45],
    [child.class, 45],
    [child.barangay, 45]
  ];
  const candidatesByText = new Map();

  weightedValues.forEach(([value, weight]) => {
    const normalized = normalizeSearchText(value);
    if (!normalized) return;
    const current = candidatesByText.get(normalized);
    if (!current || weight > current.weight) {
      candidatesByText.set(normalized, {
        normalized,
        tokens: normalized.split(/\s+/).filter(Boolean),
        weight
      });
    }
  });

  return Array.from(candidatesByText.values());
};

const getMaxFuzzyDistance = (token) => {
  if (token.length < 2) return 0;
  if (token.length <= 3) return 1;
  if (token.length <= 7) return 2;
  return 3;
};

const getEditDistanceWithin = (a, b, maxDistance) => {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) return maxDistance + 1;
    previous = current;
  }

  return previous[b.length];
};

const getTokenMatchScore = (queryToken, candidateToken) => {
  if (!queryToken || !candidateToken) return 0;
  if (queryToken === candidateToken) return 100;
  if (candidateToken.startsWith(queryToken)) return queryToken.length === 1 ? 70 : 90;
  if (queryToken.startsWith(candidateToken) && candidateToken.length >= 2) return 76;
  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return 72;

  const maxDistance = getMaxFuzzyDistance(queryToken);
  if (!maxDistance || candidateToken.length < 2) return 0;

  const distance = getEditDistanceWithin(queryToken, candidateToken, maxDistance);
  if (distance > maxDistance) return 0;
  return Math.max(45, 70 - distance * 11);
};

const getCandidateSearchScore = (normalizedQuery, queryTokens, candidate) => {
  if (!candidate.normalized) return 0;
  if (candidate.normalized === normalizedQuery) return 1000 + candidate.weight;
  if (normalizedQuery && candidate.normalized.startsWith(normalizedQuery)) return 930 + candidate.weight;
  if (normalizedQuery && candidate.normalized.includes(normalizedQuery)) return 880 + candidate.weight;
  if (normalizedQuery.length >= 2 && candidate.normalized.length >= 2 && normalizedQuery.includes(candidate.normalized)) return 700 + candidate.weight;
  if (!queryTokens.length) return 0;

  let total = 0;
  let exactMatches = 0;
  let prefixMatches = 0;

  for (const queryToken of queryTokens) {
    let best = 0;
    for (const candidateToken of candidate.tokens) {
      best = Math.max(best, getTokenMatchScore(queryToken, candidateToken));
    }

    const threshold = queryToken.length === 1 ? 70 : queryToken.length <= 3 ? 58 : 45;
    if (best < threshold) return 0;

    total += best;
    if (best === 100) exactMatches += 1;
    if (best >= 90) prefixMatches += 1;
  }

  const average = total / queryTokens.length;
  return 500 + candidate.weight + average * 3 + exactMatches * 25 + prefixMatches * 12;
};

const getChildSearchScore = (child, normalizedQuery, queryTokens, digitsOnly) => {
  let bestScore = 0;
  const patientId = String(child.patientId || '');

  if (digitsOnly.length >= 2 && patientId.includes(digitsOnly)) {
    bestScore = Math.max(bestScore, 2000 + digitsOnly.length * 10 - patientId.indexOf(digitsOnly));
  }

  getSearchCandidates(child).forEach((candidate) => {
    bestScore = Math.max(bestScore, getCandidateSearchScore(normalizedQuery, queryTokens, candidate));
  });

  return bestScore;
};

// Children operations
export const getAllChildren = async () => {
  const children = await db.children.toArray();
  return sortChildrenByLastName(children);
};

export const getChild = async (childId) => {
  return await db.children.get(childId);
};

export const searchChildren = async (query) => {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(query);
  const digitsOnly = String(query ?? '').replace(/\D/g, '');
  const children = await db.children.toArray();

  if (!normalizedQuery && digitsOnly.length < 2) {
    return sortChildrenByLastName(children);
  }

  return children
    .map(child => ({ child, score: getChildSearchScore(child, normalizedQuery, queryTokens, digitsOnly) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareChildrenByLastName(a.child, b.child);
    })
    .map(({ child }) => child);
};

export const upsertChild = async (childData) => {
  await db.children.put(childData);
  return childData;
};

// Delete child and cascade to visits and appointments
export const deleteChild = async (childId) => {
  // Delete all visits for this child
  await db.visits.where('childId').equals(childId).delete();
  // Delete all appointments for this child
  await db.appointments.where('childId').equals(childId).delete();
  // Delete the child record
  await db.children.delete(childId);
};

// Check for possible duplicates (fullName is firstName + ' ' + lastName)
export const checkDuplicates = async (childData) => {
  const { school, fullName, firstName, lastName, dob, age } = childData;
  const nameToMatch = (fullName != null && fullName !== '') ? fullName : [firstName, lastName].filter(Boolean).join(' ').trim();
  const matches = await db.children
    .filter(child => {
      if (child.school !== school) return false;
      const childFull = child.fullName || [child.firstName, child.lastName].filter(Boolean).join(' ');
      const nameSimilar = nameToMatch && (childFull.toLowerCase().includes(nameToMatch.toLowerCase()) ||
                         nameToMatch.toLowerCase().includes(childFull.toLowerCase()));
      if (!nameSimilar) return false;
      
      if (dob && child.dob) {
        return Math.abs(new Date(dob) - new Date(child.dob)) < 86400000; // Same day
      }
      if (age && child.age) {
        return Math.abs(age - child.age) <= 1; // Within 1 year
      }
      return false;
    })
    .toArray();
  
  return matches;
};

// Visits operations
export const getVisitsByChild = async (childId) => {
  return await db.visits
    .where('childId')
    .equals(childId)
    .sortBy('date');
};

export const getAllVisits = async () => {
  return await db.visits.toArray();
};

// Get only manually added visits (exclude auto-generated missed appointment visits)
export const getManualVisits = async () => {
  const allVisits = await db.visits.toArray();
  // Filter out visits that were auto-generated from missed appointments
  // These have notes containing "Missed appointment on" and "Reschedule needed"
  return allVisits.filter(visit => {
    if (!visit.notes) return true; // Keep visits without notes
    // Exclude if notes contain the auto-generated pattern
    const notes = visit.notes.toLowerCase();
    return !(notes.includes('missed appointment on') && notes.includes('reschedule needed'));
  });
};

export const addVisit = async (visitData) => {
  await db.visits.add(visitData);
  return visitData;
};

// Delete a single visit
export const deleteVisit = async (visitId) => {
  await db.visits.delete(visitId);
};

// Update existing visit
export const updateVisit = async (visitData) => {
  await db.visits.put(visitData);
  return visitData;
};

// Get a single visit by ID
export const getVisit = async (visitId) => {
  return await db.visits.get(visitId);
};

// Coerce flag to boolean (handles true, "true", 1, and legacy data)
const asBoolean = (value) => value === true || value === 'true' || value === 1;

// Graduation order: lower = graduates sooner = higher priority (Grade 6 first … Kindergarten).
const GRADUATION_ORDER = {
  'Grade 6': 0,
  'Grade 5': 1,
  'Grade 4': 2,
  'Grade 3': 3,
  'Grade 2': 4,
  'Grade 1': 5,
  Kindergarten: 6,
  Graduated: 90,
  Teacher: 91,
  '6th Grade': 0,
  '5th Grade': 1,
  '4th Grade': 2,
  '3rd Grade': 3,
  '2nd Grade': 4,
  '1st Grade': 5,
  'SPED VI': 14,
  'SPED V': 14,
  'SPED IV': 14,
  'SPED III': 14,
  'SPED II': 14,
  'SPED I': 14,
  'SPED Kinder/Prep': 14
};
export const getGraduationOrder = (grade) => {
  if (grade == null || grade === '') return 99;
  return GRADUATION_ORDER[String(grade).trim()] ?? 99;
};

// Two tiers only: 1 = High priority, 2 = Routine
const calculateTier = (visit) => {
  if (!visit || typeof visit !== 'object') return 2;
  const pain = asBoolean(visit.painFlag);
  const swelling = asBoolean(visit.swellingFlag);
  if (swelling || pain) return 1; // High priority
  const decayed = visit.decayedTeeth !== null && visit.decayedTeeth !== undefined ? Number(visit.decayedTeeth) : 0;
  if (!Number.isNaN(decayed) && decayed >= 3) return 1; // High priority
  return 2; // Routine
};

// High-risk visits with tiered ranking
export const getHighRiskVisits = async () => {
  // Get all visits (not just pain/swelling, to include all tiers)
  const visits = await db.visits.toArray();
  
  // Group visits by childId and keep only the latest visit for each child
  const visitsByChild = {};
  visits.forEach(visit => {
    const childId = visit.childId;
    if (!visitsByChild[childId]) {
      visitsByChild[childId] = visit;
    } else {
      // Compare dates to find the most recent visit
      const existingDate = new Date(visitsByChild[childId].date);
      const currentDate = new Date(visit.date);
      
      // If dates are equal, use createdAt as tiebreaker
      if (currentDate > existingDate || 
          (currentDate.getTime() === existingDate.getTime() && 
           new Date(visit.createdAt) > new Date(visitsByChild[childId].createdAt))) {
        visitsByChild[childId] = visit;
      }
    }
  });
  
  // Get only the latest visit for each child
  const latestVisits = Object.values(visitsByChild);
  
  // Get child info for each visit and calculate tier/score
  const visitsWithChildren = await Promise.all(
    latestVisits.map(async (visit) => {
      const child = await getChild(visit.childId);
      const tier = calculateTier(visit);
      return { 
        ...visit, 
        child,
        tier,
        tierName: tier === 1 ? 'High priority' : 'Routine'
      };
    })
  );
  
  // Hospital order: graduation (earliest first = Grade 6 first), then tier, then decayed teeth (higher first), then latest visit (most recent first)
  return visitsWithChildren.sort((a, b) => {
    const gradeA = getGraduationOrder(a.child?.grade);
    const gradeB = getGraduationOrder(b.child?.grade);
    if (gradeA !== gradeB) return gradeA - gradeB;
    if (a.tier !== b.tier) return a.tier - b.tier;
    const decayedA = a.decayedTeeth != null ? a.decayedTeeth : 0;
    const decayedB = b.decayedTeeth != null ? b.decayedTeeth : 0;
    if (decayedA !== decayedB) return decayedB - decayedA;
    return new Date(b.date) - new Date(a.date);
  });
};

// Clinic Day operations
export const getAllClinicDays = async () => {
  return await db.clinicDays.orderBy('date').reverse().toArray();
};

export const getClinicDay = async (clinicDayId) => {
  return await db.clinicDays.get(clinicDayId);
};

export const getClinicDaysByDateRange = async (startDate, endDate) => {
  return await db.clinicDays
    .where('date')
    .between(startDate, endDate, true, true)
    .sortBy('date');
};

export const upsertClinicDay = async (clinicDayData) => {
  await db.clinicDays.put(clinicDayData);
  return clinicDayData;
};

// Delete clinic day and cascade to appointments
export const deleteClinicDay = async (clinicDayId) => {
  // Delete all appointments for this clinic day
  await db.appointments.where('clinicDayId').equals(clinicDayId).delete();
  // Delete the clinic day record
  await db.clinicDays.delete(clinicDayId);
};

// Appointment operations
export const getAppointment = async (appointmentId) => {
  return await db.appointments.get(appointmentId);
};

export const getAppointmentsByClinicDay = async (clinicDayId) => {
  return await db.appointments
    .where('clinicDayId')
    .equals(clinicDayId)
    .toArray();
};

export const getAppointmentsByChild = async (childId) => {
  return await db.appointments
    .where('childId')
    .equals(childId)
    .toArray();
};

export const getAllScheduledAppointments = async () => {
  return await db.appointments
    .where('status')
    .equals('SCHEDULED')
    .toArray();
};

export const getAppointmentsByStatus = async (status) => {
  if (!status) return [];
  return await db.appointments
    .where('status')
    .equals(status)
    .toArray();
};

export const upsertAppointment = async (appointmentData) => {
  await db.appointments.put(appointmentData);
  return appointmentData;
};

export const deleteAppointment = async (appointmentId) => {
  await db.appointments.delete(appointmentId);
};

export const getAppointmentCountForClinicDay = async (clinicDayId, status = null) => {
  let query = db.appointments.where('clinicDayId').equals(clinicDayId);
  if (status) {
    query = query.and(a => a.status === status);
  }
  return await query.count();
};

// Sync operations
export const syncPush = async (token) => {
  const ops = await getOutboxOps();
  if (ops.length === 0) return { ackedOpIds: [] };

  const response = await fetch(`${API_BASE_URL}${getApiPath('/sync/push')}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ ops })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg = result?.error || result?.details || response.statusText;
    throw new Error(`Sync push failed: ${msg}`);
  }

  if (result.errors && result.errors.length > 0) {
    console.warn('Sync push had errors for some ops:', result.errors);
  }

  if (result.ackedOpIds && result.ackedOpIds.length > 0) {
    await removeFromOutbox(result.ackedOpIds);
  }
  return result;
};

export const syncPull = async (token, since = null, scope = 'ALL') => {
  // If local DB is empty (fresh browser/device), force a full pull regardless of stale lastSyncAt
  // so seed/demo data can be loaded.
  const localChildCount = await db.children.count().catch(() => 0);
  const storedLastSync = await getLastSyncAt();
  const lastSync = (since || (localChildCount > 0 ? storedLastSync : null));
  const params = new URLSearchParams();
  if (lastSync) {
    params.append('since', lastSync);
  }
  if (scope !== 'ALL') {
    params.append('scope', scope);
  }
  const queryString = params.toString();
  const url = `${API_BASE_URL}${getApiPath('/sync/pull')}${queryString ? '?' + queryString : ''}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Sync pull failed');
  }

  const result = await response.json();
  
  // Store children (merge so pull does not clobber toothStates / consent / notes)
  if (result.children && result.children.length > 0) {
    const mergedChildren = await Promise.all(
      result.children.map(async (row) => {
        const local = row.childId ? await db.children.get(row.childId) : null;
        return mergeChildRowFromPull(row, local);
      })
    );
    await db.children.bulkPut(mergedChildren);
  }
  
  // Store visits (merge so pull does not drop local medications / tooth snapshots)
  if (result.visits && result.visits.length > 0) {
    const mergedVisits = await Promise.all(
      result.visits.map(async (row) => {
        const local = row.visitId ? await db.visits.get(row.visitId) : null;
        return mergeVisitRowFromPull(row, local);
      })
    );
    await db.visits.bulkPut(mergedVisits);
  }
  
  // Store clinic days (merge so pull does not overwrite fresh AM/PM with null/legacy server fields)
  if (result.clinicDays && result.clinicDays.length > 0) {
    const merged = await Promise.all(
      result.clinicDays.map(async (row) => {
        const local = row.clinicDayId ? await db.clinicDays.get(row.clinicDayId) : null;
        return mergeClinicDayRowFromPull(row, local);
      })
    );
    await db.clinicDays.bulkPut(merged);
  }
  
  // Store appointments (merge so pull does not clobber nullable / optional fields)
  if (result.appointments && result.appointments.length > 0) {
    const mergedAppointments = await Promise.all(
      result.appointments.map(async (row) => {
        const local = row.appointmentId ? await db.appointments.get(row.appointmentId) : null;
        return mergeAppointmentRowFromPull(row, local);
      })
    );
    await db.appointments.bulkPut(mergedAppointments);
  }
  
  // Handle deletions: remove local records that don't exist on server
  let deletedChildrenCount = 0;
  let deletedVisitsCount = 0;
  let deletedClinicDaysCount = 0;
  let deletedAppointmentsCount = 0;
  
  if (result.allChildIds && Array.isArray(result.allChildIds)) {
    const localChildren = await db.children.toCollection().primaryKeys();
    const serverChildIds = new Set(result.allChildIds);
    const toDelete = localChildren.filter(id => !serverChildIds.has(id));
    
    if (toDelete.length > 0) {
      // Also delete visits for deleted children
      const deletedChildIds = new Set(toDelete);
      const allVisits = await db.visits.toArray();
      const visitsToDelete = allVisits
        .filter(v => deletedChildIds.has(v.childId))
        .map(v => v.visitId);
      
      if (visitsToDelete.length > 0) {
        await db.visits.bulkDelete(visitsToDelete);
        deletedVisitsCount = visitsToDelete.length;
      }
      
      await db.children.bulkDelete(toDelete);
      deletedChildrenCount = toDelete.length;
    }
  }
  
  // Pending upserts must survive pull-side deletion: push may fail or not be acked yet,
  // but we would otherwise remove "only local" rows and make batch edits look like no-ops.
  const outboxOps = await getOutboxOps();
  const pendingClinicDayUpserts = new Set(
    outboxOps.filter((o) => o.action === 'UPSERT_CLINIC_DAY' && o.entityId).map((o) => o.entityId)
  );
  const pendingAppointmentUpserts = new Set(
    outboxOps.filter((o) => o.action === 'UPSERT_APPOINTMENT' && o.entityId).map((o) => o.entityId)
  );

  if (result.allVisitIds && Array.isArray(result.allVisitIds)) {
    const localVisits = await db.visits.toCollection().primaryKeys();
    const serverVisitIds = new Set(result.allVisitIds);
    const toDelete = localVisits.filter(id => !serverVisitIds.has(id));
    
    if (toDelete.length > 0) {
      await db.visits.bulkDelete(toDelete);
      deletedVisitsCount += toDelete.length;
    }
  }
  
  if (result.allClinicDayIds && Array.isArray(result.allClinicDayIds)) {
    const localClinicDays = await db.clinicDays.toCollection().primaryKeys();
    const serverClinicDayIds = new Set(result.allClinicDayIds);
    const toDelete = localClinicDays.filter(
      (id) => !serverClinicDayIds.has(id) && !pendingClinicDayUpserts.has(id)
    );
    
    if (toDelete.length > 0) {
      // Also delete appointments for deleted clinic days
      const deletedClinicDayIds = new Set(toDelete);
      const allAppointments = await db.appointments.toArray();
      const appointmentsToDelete = allAppointments
        .filter(
          (a) =>
            deletedClinicDayIds.has(a.clinicDayId) &&
            !pendingAppointmentUpserts.has(a.appointmentId)
        )
        .map((a) => a.appointmentId);
      
      if (appointmentsToDelete.length > 0) {
        await db.appointments.bulkDelete(appointmentsToDelete);
        deletedAppointmentsCount += appointmentsToDelete.length;
      }
      
      await db.clinicDays.bulkDelete(toDelete);
      deletedClinicDaysCount = toDelete.length;
    }
  }
  
  if (result.allAppointmentIds && Array.isArray(result.allAppointmentIds)) {
    const localAppointments = await db.appointments.toCollection().primaryKeys();
    const serverAppointmentIds = new Set(result.allAppointmentIds);
    const toDelete = localAppointments.filter(
      (id) => !serverAppointmentIds.has(id) && !pendingAppointmentUpserts.has(id)
    );
    
    if (toDelete.length > 0) {
      await db.appointments.bulkDelete(toDelete);
      deletedAppointmentsCount += toDelete.length;
    }
  }
  
  // Return deletion count for UI feedback
  result.deletedCount = deletedChildrenCount + deletedVisitsCount + deletedClinicDaysCount + deletedAppointmentsCount;
  
  // Update last sync time
  if (result.serverTime) {
    await setLastSyncAt(result.serverTime);
  }
  
  return result;
};

export const performSync = async (token) => {
  try {
    // Push first
    await syncPush(token);
    
    // Then pull (this handles deletions and sets deletedCount on result)
    const pullResult = await syncPull(token);
    
    return { 
      success: true, 
      deletedCount: pullResult.deletedCount || 0,
      message: (pullResult.deletedCount || 0) > 0 
        ? `Sync completed. Removed ${pullResult.deletedCount} deleted record(s).` 
        : 'Sync completed successfully!'
    };
  } catch (error) {
    console.error('Sync error:', error);
    return { success: false, error: error.message };
  }
};

// Force a full pull (ignores lastSyncAt) - useful for refreshing demo data
export const performFullSync = async (token) => {
  try {
    await syncPush(token);
    const pullResult = await syncPull(token, '1970-01-01T00:00:00.000Z');
    return {
      success: true,
      deletedCount: pullResult.deletedCount || 0,
      message: 'Full sync completed successfully!'
    };
  } catch (error) {
    console.error('Full sync error:', error);
    return { success: false, error: error.message };
  }
};

export default db;
