import express from 'express';
import crypto from 'crypto';
import Child from '../models/Child.js';
import ParentFormToken from '../models/ParentFormToken.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/** Field keys staff may include on the parent questionnaire. */
export const PARENT_FORM_FIELD_DEFS = [
  { id: 'patientId', label: 'Patient ID' },
  { id: 'sex', label: 'Gender' },
  { id: 'dob', label: 'Date of Birth' },
  { id: 'age', label: 'Age (if Date of Birth unknown)' },
  { id: 'school', label: 'School' },
  { id: 'grade', label: 'Grade' },
  { id: 'class', label: 'Class' },
  { id: 'notes', label: 'Notes' },
  { id: 'guardianName', label: 'Guardian Name' },
  { id: 'relationship', label: 'Relationship' },
  { id: 'guardianPhone', label: 'Phone' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'address', label: 'Address' },
  { id: 'allergy', label: 'Allergy' },
  { id: 'medicalHistory', label: 'Medical History' },
  { id: 'behaviourFrankl', label: 'Behavior (Frankl scale 1-4)' }
];

const ALLOWED_IDS = new Set(PARENT_FORM_FIELD_DEFS.map((f) => f.id));

function normalizeFieldsMap(body) {
  const raw = body?.fields;
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_IDS.has(k)) continue;
    out[k] = Boolean(v);
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

function readMedical(child) {
  const mc = child?.medicalCondition;
  return mc != null && typeof mc === 'object' && !Array.isArray(mc) ? mc : {};
}

function splitPatientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function normalizePatientId(value) {
  const s = value != null ? String(value).trim() : '';
  return /^\d{6}$/.test(s) ? s : null;
}

function parseDob(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseAge(value) {
  if (value == null || value === '') return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function applyFieldsToChild(child, body, fieldsMap) {
  const mc = readMedical(child);
  const nextMc = { ...mc };

  if (fieldsMap.patientId) child.patientId = normalizePatientId(body.patientId);
  if (fieldsMap.sex) {
    const sex = String(body.sex || '').trim();
    child.sex = ['M', 'F', 'Other'].includes(sex) ? sex : child.sex;
  }
  if (fieldsMap.dob) child.dob = parseDob(body.dob);
  if (fieldsMap.age) child.age = child.dob ? null : parseAge(body.age);
  if (fieldsMap.school) child.school = body.school != null ? String(body.school).trim() || child.school : child.school;
  if (fieldsMap.grade) child.grade = body.grade != null ? String(body.grade).trim() || null : null;
  if (fieldsMap.class) child.class = body.class != null ? String(body.class).trim() || null : null;
  if (fieldsMap.notes) child.notes = body.notes != null ? String(body.notes).trim() || null : null;
  if (fieldsMap.guardianName) child.guardianName = body.guardianName != null ? String(body.guardianName).trim() || null : null;
  if (fieldsMap.relationship) child.relationship = body.relationship != null ? String(body.relationship).trim() || null : null;
  if (fieldsMap.guardianPhone) child.guardianPhone = body.guardianPhone != null ? String(body.guardianPhone).trim() || null : null;
  if (fieldsMap.messenger) child.messenger = body.messenger != null ? String(body.messenger).trim() || null : null;
  if (fieldsMap.address) child.address = body.address != null ? String(body.address).trim() || null : null;
  if (fieldsMap.allergy) nextMc.allergy = body.allergy != null ? String(body.allergy).trim() || null : null;
  if (fieldsMap.medicalHistory) nextMc.medicalHistory = body.medicalHistory != null ? String(body.medicalHistory).trim() || null : null;
  if (fieldsMap.behaviourFrankl) {
    const n = parseInt(String(body.behaviourFrankl ?? ''), 10);
    nextMc.behaviourFrankl = Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
  }
  child.medicalCondition = nextMc;
}

function buildInitialPayload(child, fieldsMap) {
  const mc = readMedical(child);
  const initial = {};
  if (fieldsMap.patientId) initial.patientId = child.patientId != null ? String(child.patientId) : '';
  if (fieldsMap.sex) initial.sex = child.sex != null ? String(child.sex) : '';
  if (fieldsMap.dob) initial.dob = child.dob ? new Date(child.dob).toISOString().split('T')[0] : '';
  if (fieldsMap.age) initial.age = child.age != null ? String(child.age) : '';
  if (fieldsMap.school) initial.school = child.school != null ? String(child.school) : '';
  if (fieldsMap.grade) initial.grade = child.grade != null ? String(child.grade) : '';
  if (fieldsMap.class) initial.class = child.class != null ? String(child.class) : '';
  if (fieldsMap.notes) initial.notes = child.notes != null ? String(child.notes) : '';
  if (fieldsMap.guardianName) initial.guardianName = child.guardianName != null ? String(child.guardianName) : '';
  if (fieldsMap.relationship) initial.relationship = child.relationship != null ? String(child.relationship) : '';
  if (fieldsMap.guardianPhone) initial.guardianPhone = child.guardianPhone != null ? String(child.guardianPhone) : '';
  if (fieldsMap.messenger) initial.messenger = child.messenger != null ? String(child.messenger) : '';
  if (fieldsMap.address) initial.address = child.address != null ? String(child.address) : '';
  if (fieldsMap.allergy) initial.allergy = mc.allergy != null ? String(mc.allergy) : '';
  if (fieldsMap.medicalHistory) initial.medicalHistory = mc.medicalHistory != null ? String(mc.medicalHistory) : '';
  if (fieldsMap.behaviourFrankl) {
    initial.behaviourFrankl =
      mc.behaviourFrankl != null && mc.behaviourFrankl !== '' ? String(mc.behaviourFrankl) : '';
  }
  return initial;
}

/** Public: submit parent questionnaire (must be registered before generic `/:token` handlers if any). */
router.post('/:token/submit', async (req, res) => {
  try {
    const { token } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const row = await ParentFormToken.findOne({ token });
    if (!row) {
      return res.status(404).json({ ok: false, error: 'This link is not valid.' });
    }
    const now = new Date();
    if (row.usedAt) {
      return res.status(400).json({ ok: false, error: 'This form has already been submitted.' });
    }
    if (row.expiresAt && new Date(row.expiresAt) < now) {
      return res.status(400).json({ ok: false, error: 'This link has expired.' });
    }

    const fieldsMap = row.fieldsRequested && typeof row.fieldsRequested === 'object' ? row.fieldsRequested : {};
    let child;
    if (row.mode === 'create') {
      const fullName = String(row.patientName || '').trim();
      if (!fullName) {
        return res.status(400).json({ ok: false, error: 'Patient name is missing.' });
      }
      const { firstName, lastName } = splitPatientName(fullName);
      const nowIso = new Date().toISOString();
      child = new Child({
        childId: `child-${crypto.randomUUID()}`,
        fullName,
        firstName: row.firstName || firstName || null,
        lastName: row.lastName || lastName || null,
        sex: 'Other',
        school: 'UNKNOWN',
        barangay: '',
        priority: 'P2',
        createdBy: row.createdBy || 'parent-form',
        updatedBy: row.createdBy || 'parent-form',
        createdAt: nowIso,
        updatedAt: nowIso
      });
    } else {
      child = await Child.findOne({ childId: row.childId });
      if (!child) {
        return res.status(404).json({ ok: false, error: 'Patient record was removed.' });
      }
    }

    applyFieldsToChild(child, body, fieldsMap);

    child.updatedAt = new Date();
    await child.save();

    row.usedAt = new Date();
    await row.save();

    res.json({ ok: true });
  } catch (e) {
    console.error('parent-form submit', e);
    res.status(500).json({ ok: false, error: 'Could not save responses' });
  }
});

/** Staff: create a one-time (or 24h) parent link. */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { childId, fields, mode, patientName } = req.body || {};
    const tokenMode = mode === 'create' ? 'create' : 'update';
    const fieldsMap = normalizeFieldsMap({ fields });
    if (!fieldsMap) {
      return res.status(400).json({ error: 'Select at least one field for the form' });
    }

    let child = null;
    let nameParts = null;
    if (tokenMode === 'update') {
      if (!childId || typeof childId !== 'string') {
        return res.status(400).json({ error: 'childId is required' });
      }
      child = await Child.findOne({ childId }).lean();
      if (!child) return res.status(404).json({ error: 'Patient not found' });
    } else {
      const name = String(patientName || '').trim();
      if (!name) return res.status(400).json({ error: 'Patient name is required' });
      nameParts = splitPatientName(name);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await ParentFormToken.create({
      token,
      mode: tokenMode,
      childId: tokenMode === 'update' ? childId : null,
      patientName: tokenMode === 'create' ? String(patientName).trim() : null,
      firstName: nameParts?.firstName || null,
      lastName: nameParts?.lastName || null,
      fieldsRequested: fieldsMap,
      expiresAt,
      createdBy: req.user?.username || null
    });

    res.json({
      token,
      expiresAt: expiresAt.toISOString(),
      fields: fieldsMap
    });
  } catch (e) {
    console.error('parent-form create', e);
    res.status(500).json({ error: 'Could not create form link' });
  }
});

router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const row = await ParentFormToken.findOne({ token }).lean();
    if (!row) {
      return res.status(404).json({ ok: false, error: 'This link is not valid.' });
    }
    const now = new Date();
    if (row.usedAt) {
      return res.json({
        ok: false,
        expired: true,
        error: 'This form has already been submitted.'
      });
    }
    if (row.expiresAt && new Date(row.expiresAt) < now) {
      return res.json({
        ok: false,
        expired: true,
        error: 'This link has expired.'
      });
    }

    const fieldsMap = row.fieldsRequested && typeof row.fieldsRequested === 'object' ? row.fieldsRequested : {};
    let initial = {};
    let displayName = row.patientName || 'Patient';
    if (row.mode !== 'create') {
      const child = await Child.findOne({ childId: row.childId }).lean();
      if (!child) {
        return res.status(404).json({ ok: false, error: 'Patient record was removed.' });
      }
      initial = buildInitialPayload(child, fieldsMap);
      displayName = [child.firstName, child.lastName].filter(Boolean).join(' ').trim() || child.fullName || 'Patient';
    }

    res.json({
      ok: true,
      expired: false,
      mode: row.mode || 'update',
      childName: displayName,
      fields: fieldsMap,
      initial,
      expiresAt: row.expiresAt
    });
  } catch (e) {
    console.error('parent-form get', e);
    res.status(500).json({ ok: false, error: 'Could not load form' });
  }
});

export default router;
