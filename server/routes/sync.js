import express from 'express';
import Child from '../models/Child.js';
import Visit from '../models/Visit.js';
import ClinicDay from '../models/ClinicDay.js';
import Appointment from '../models/Appointment.js';
import ProcessedOp from '../models/ProcessedOp.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Ensure treatmentTypes is always an array of strings for DB storage
function normalizeTreatmentTypes(value) {
  if (Array.isArray(value)) {
    return value.filter(t => t != null && typeof t === 'string').map(t => String(t).trim()).filter(Boolean);
  }
  if (value != null && typeof value === 'string') return [value.trim()].filter(Boolean);
  return [];
}

const FOLLOW_UP_TIMING_VALUES = ['WITHIN_7_DAYS', 'WITHIN_14_DAYS', 'WHENEVER'];

function normalizeFollowUpTiming(raw) {
  const s = String(raw ?? '').trim();
  if (FOLLOW_UP_TIMING_VALUES.includes(s)) return s;
  if (s === 'P0' || s === 'P1') return 'WITHIN_7_DAYS';
  if (s === 'P2') return 'WITHIN_14_DAYS';
  if (s === 'P3') return 'WHENEVER';
  return 'WITHIN_14_DAYS';
}

function parseFollowUpDueAt(value) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Push operations from client
router.post('/push', authenticateToken, async (req, res) => {
  try {
    const { ops } = req.body;
    if (!Array.isArray(ops)) {
      return res.status(400).json({ error: 'ops must be an array' });
    }

    const ackedOpIds = [];
    const errors = [];

    for (const op of ops) {
      try {
        // Check if operation already processed (idempotency)
        const existing = await ProcessedOp.findOne({ opId: op.opId });
        if (existing) {
          ackedOpIds.push(op.opId);
          continue;
        }

        // Process operation based on action
        const username = req.user?.username || 'unknown';
        
        if (op.action === 'UPSERT_CHILD') {
          const p = op.payload;
          // Ensure createdBy is set
          const createdBy = p.createdBy || username;
          const existing = await Child.findOne({ childId: p.childId });
          const updatedBy = existing ? username : (p.updatedBy || createdBy);
          // Build explicit update so every schema field (including notes) is written to MongoDB
          const fullNameFromParts = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
          const patientIdRaw = p.patientId != null ? String(p.patientId).trim() : '';
          const patientIdVal = /^\d{6}$/.test(patientIdRaw) ? patientIdRaw : null;
          const childData = {
            childId: p.childId,
            fullName: fullNameFromParts || p.fullName,
            firstName: p.firstName != null && p.firstName !== '' ? p.firstName : null,
            lastName: p.lastName != null && p.lastName !== '' ? p.lastName : null,
            dob: p.dob ? new Date(p.dob) : null,
            age: p.age != null ? p.age : null,
            sex: p.sex,
            school: p.school,
            grade: p.grade != null && p.grade !== '' ? p.grade : null,
            class: p.class != null && p.class !== '' ? p.class : null,
            barangay: p.barangay != null && String(p.barangay).trim() !== '' ? String(p.barangay).trim() : '',
            guardianName: p.guardianName != null && p.guardianName !== '' ? p.guardianName : null,
            relationship: p.relationship != null && p.relationship !== '' ? p.relationship : null,
            guardianPhone: p.guardianPhone != null && p.guardianPhone !== '' ? p.guardianPhone : null,
            messenger: p.messenger != null && p.messenger !== '' ? p.messenger : null,
            address: p.address != null && p.address !== '' ? p.address : null,
            priority: p.priority != null && p.priority !== '' ? p.priority : 'P2',
            consentGeneralReceivedAt: p.consentGeneralReceivedAt ? new Date(p.consentGeneralReceivedAt) : null,
            consentSpecific: Array.isArray(p.consentSpecific)
              ? p.consentSpecific
                  .filter(e => e && typeof e === 'object')
                  .map(e => ({
                    procedure: e.procedure != null ? String(e.procedure).trim() : '',
                    date: e.date ? new Date(e.date) : null
                  }))
                  .filter(e => e.procedure !== '')
              : [],
            notes: p.notes != null && p.notes !== '' ? p.notes : null,
            medicalCondition:
              p.medicalCondition != null && typeof p.medicalCondition === 'object' && !Array.isArray(p.medicalCondition)
                ? p.medicalCondition
                : existing?.medicalCondition != null && typeof existing.medicalCondition === 'object'
                  ? existing.medicalCondition
                  : {},
            toothStates:
              p.toothStates != null && typeof p.toothStates === 'object' && !Array.isArray(p.toothStates)
                ? p.toothStates
                : existing?.toothStates != null && typeof existing.toothStates === 'object'
                  ? existing.toothStates
                  : {},
            createdBy,
            updatedBy,
            createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
            updatedAt: new Date()
          };
          if (patientIdVal) {
            childData.patientId = patientIdVal;
          }
          const updateOps = { $set: childData };
          if (!patientIdVal) {
            updateOps.$unset = { patientId: '' };
          }
          await Child.findOneAndUpdate(
            { childId: p.childId },
            updateOps,
            { upsert: true, new: true }
          );
        } else if (op.action === 'ADD_VISIT') {
          const payload = op.payload;
          // Create clean visitData with only allowed fields; always sync treatment data
          const visitData = {
            visitId: payload.visitId,
            childId: payload.childId,
            date: payload.date,
            painFlag: payload.painFlag || false,
            swellingFlag: payload.swellingFlag || false,
            decayedTeeth: payload.decayedTeeth !== undefined ? payload.decayedTeeth : null,
            missingTeeth: payload.missingTeeth !== undefined ? payload.missingTeeth : null,
            filledTeeth: payload.filledTeeth !== undefined ? payload.filledTeeth : null,
            dentition: payload.dentition != null && payload.dentition !== '' ? String(payload.dentition) : null,
            toothRecords:
              payload.toothRecords != null &&
              typeof payload.toothRecords === 'object' &&
              !Array.isArray(payload.toothRecords)
                ? payload.toothRecords
                : null,
            toothExaminations: Array.isArray(payload.toothExaminations) ? payload.toothExaminations : null,
            symptoms:
              payload.symptoms != null &&
              typeof payload.symptoms === 'object' &&
              !Array.isArray(payload.symptoms)
                ? payload.symptoms
                : null,
            examinationNotes:
              payload.examinationNotes != null && String(payload.examinationNotes).trim() !== ''
                ? String(payload.examinationNotes).trim()
                : null,
            toothSpecificTreatments: Array.isArray(payload.toothSpecificTreatments)
              ? payload.toothSpecificTreatments
              : null,
            treatmentTypes: normalizeTreatmentTypes(
              Array.isArray(payload.treatmentTypes) && payload.treatmentTypes.length > 0
                ? payload.treatmentTypes
                : payload.treatments
            ),
            treatments: Array.isArray(payload.treatments)
              ? payload.treatments.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
              : null,
            medications: Array.isArray(payload.medications) ? payload.medications : null,
            chiefComplaint:
              payload.chiefComplaint != null && String(payload.chiefComplaint).trim() !== ''
                ? String(payload.chiefComplaint).trim()
                : null,
            notes: payload.notes || null,
            requiresFollowUp: payload.requiresFollowUp === true || payload.requiresFollowUp === 'true',
            followUpPriority:
              payload.requiresFollowUp === true || payload.requiresFollowUp === 'true'
                ? normalizeFollowUpTiming(payload.followUpPriority)
                : null,
            followUpDueAt:
              payload.requiresFollowUp === true || payload.requiresFollowUp === 'true'
                ? parseFollowUpDueAt(payload.followUpDueAt)
                : null,
            createdBy: payload.createdBy || username,
            createdAt: payload.createdAt || new Date()
          };
          
          // Check if visit already exists
          const existingVisit = await Visit.findOne({ visitId: visitData.visitId });
          if (!existingVisit) {
            await Visit.create(visitData);
          } else {
            // Update existing visit and explicitly remove old fields
            await Visit.findOneAndUpdate(
              { visitId: visitData.visitId },
              { 
                $set: visitData,
                $unset: { referralFlag: '', dmft: '', DMFT: '', type: '' }
              },
              { new: true }
            );
          }
        } else if (op.action === 'UPSERT_CLINIC_DAY') {
          const clinicDayData = { ...op.payload };
          if (!clinicDayData.createdBy) {
            clinicDayData.createdBy = username;
          }
          // Convert date strings to Date objects
          if (clinicDayData.date && typeof clinicDayData.date === 'string') {
            clinicDayData.date = new Date(clinicDayData.date);
          }
          if (clinicDayData.createdAt && typeof clinicDayData.createdAt === 'string') {
            clinicDayData.createdAt = new Date(clinicDayData.createdAt);
          }
          const result = await ClinicDay.findOneAndUpdate(
            { clinicDayId: clinicDayData.clinicDayId },
            clinicDayData,
            { upsert: true, new: true, runValidators: true }
          );
          console.log(`✓ UPSERT_CLINIC_DAY: ${clinicDayData.clinicDayId}`);
        } else if (op.action === 'UPSERT_APPOINTMENT') {
          const appointmentData = { ...op.payload };
          if (!appointmentData.createdBy) {
            appointmentData.createdBy = username;
          }
          // Convert date strings to Date objects
          if (appointmentData.createdAt && typeof appointmentData.createdAt === 'string') {
            appointmentData.createdAt = new Date(appointmentData.createdAt);
          }
          const result = await Appointment.findOneAndUpdate(
            { appointmentId: appointmentData.appointmentId },
            appointmentData,
            { upsert: true, new: true, runValidators: true }
          );
          console.log(`✓ UPSERT_APPOINTMENT: ${appointmentData.appointmentId}`);
        } else if (op.action === 'DELETE_APPOINTMENT') {
          const { appointmentId } = op.payload;
          await Appointment.findOneAndDelete({ appointmentId });
          console.log(`✓ DELETE_APPOINTMENT: ${appointmentId}`);
        } else if (op.action === 'DELETE_CLINIC_DAY') {
          // Delete clinic day and cascade to appointments
          const { clinicDayId } = op.payload;
          const deletedAppointments = await Appointment.deleteMany({ clinicDayId });
          await ClinicDay.findOneAndDelete({ clinicDayId });
          console.log(`✓ DELETE_CLINIC_DAY: ${clinicDayId} (${deletedAppointments.deletedCount} appointments)`);
        } else if (op.action === 'DELETE_CHILD') {
          // Delete child and cascade to visits and appointments
          const { childId } = op.payload;
          const deletedVisits = await Visit.deleteMany({ childId });
          const deletedAppointments = await Appointment.deleteMany({ childId });
          await Child.findOneAndDelete({ childId });
          console.log(`✓ DELETE_CHILD: ${childId} (${deletedVisits.deletedCount} visits, ${deletedAppointments.deletedCount} appointments)`);
        } else if (op.action === 'DELETE_VISIT') {
          // Delete single visit
          const { visitId } = op.payload;
          await Visit.findOneAndDelete({ visitId });
          console.log(`✓ DELETE_VISIT: ${visitId}`);
        } else if (op.action === 'UPDATE_VISIT') {
          // Update existing visit; always sync treatment data
          const payload = op.payload;
          const existingVisit = await Visit.findOne({ visitId: payload.visitId }).lean();
          const visitData = {
            visitId: payload.visitId,
            childId: payload.childId,
            date: payload.date,
            painFlag: payload.painFlag || false,
            swellingFlag: payload.swellingFlag || false,
            decayedTeeth: payload.decayedTeeth !== undefined ? payload.decayedTeeth : null,
            missingTeeth: payload.missingTeeth !== undefined ? payload.missingTeeth : null,
            filledTeeth: payload.filledTeeth !== undefined ? payload.filledTeeth : null,
            dentition:
              payload.dentition != null && payload.dentition !== ''
                ? String(payload.dentition)
                : existingVisit?.dentition ?? null,
            toothRecords:
              payload.toothRecords != null &&
              typeof payload.toothRecords === 'object' &&
              !Array.isArray(payload.toothRecords)
                ? payload.toothRecords
                : existingVisit?.toothRecords ?? null,
            toothExaminations: Array.isArray(payload.toothExaminations)
              ? payload.toothExaminations
              : Array.isArray(existingVisit?.toothExaminations)
                ? existingVisit.toothExaminations
                : null,
            symptoms:
              payload.symptoms !== undefined
                ? payload.symptoms != null &&
                  typeof payload.symptoms === 'object' &&
                  !Array.isArray(payload.symptoms)
                  ? payload.symptoms
                  : null
                : existingVisit?.symptoms ?? null,
            examinationNotes:
              payload.examinationNotes !== undefined
                ? payload.examinationNotes != null && String(payload.examinationNotes).trim() !== ''
                  ? String(payload.examinationNotes).trim()
                  : null
                : existingVisit?.examinationNotes ?? null,
            toothSpecificTreatments:
              payload.toothSpecificTreatments !== undefined
                ? Array.isArray(payload.toothSpecificTreatments)
                  ? payload.toothSpecificTreatments
                  : null
                : Array.isArray(existingVisit?.toothSpecificTreatments)
                  ? existingVisit.toothSpecificTreatments
                  : null,
            treatmentTypes: normalizeTreatmentTypes(
              Array.isArray(payload.treatmentTypes) && payload.treatmentTypes.length > 0
                ? payload.treatmentTypes
                : payload.treatments ?? existingVisit?.treatmentTypes
            ),
            treatments:
              payload.treatments !== undefined
                ? Array.isArray(payload.treatments)
                  ? payload.treatments.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
                  : null
                : Array.isArray(existingVisit?.treatments)
                  ? existingVisit.treatments
                  : null,
            medications:
              payload.medications !== undefined
                ? Array.isArray(payload.medications)
                  ? payload.medications
                  : null
                : Array.isArray(existingVisit?.medications)
                  ? existingVisit.medications
                  : null,
            chiefComplaint:
              payload.chiefComplaint !== undefined
                ? payload.chiefComplaint != null && String(payload.chiefComplaint).trim() !== ''
                  ? String(payload.chiefComplaint).trim()
                  : null
                : existingVisit?.chiefComplaint ?? null,
            notes: payload.notes || null,
            requiresFollowUp:
              payload.requiresFollowUp !== undefined
                ? payload.requiresFollowUp === true || payload.requiresFollowUp === 'true'
                : Boolean(existingVisit?.requiresFollowUp),
            followUpPriority:
              payload.requiresFollowUp !== undefined
                ? payload.requiresFollowUp === true || payload.requiresFollowUp === 'true'
                  ? normalizeFollowUpTiming(payload.followUpPriority)
                  : null
                : existingVisit?.followUpPriority != null
                  ? normalizeFollowUpTiming(existingVisit.followUpPriority)
                  : null,
            followUpDueAt:
              payload.requiresFollowUp !== undefined
                ? payload.requiresFollowUp === true || payload.requiresFollowUp === 'true'
                  ? parseFollowUpDueAt(payload.followUpDueAt)
                  : null
                : existingVisit?.followUpDueAt != null
                  ? parseFollowUpDueAt(existingVisit.followUpDueAt)
                  : null,
            updatedBy: payload.updatedBy || username,
            updatedAt: new Date()
          };
          await Visit.findOneAndUpdate(
            { visitId: visitData.visitId },
            { $set: visitData, $unset: { type: '' } },
            { new: true }
          );
          console.log(`✓ UPDATE_VISIT: ${visitData.visitId}`);
        }

        // Mark operation as processed
        await ProcessedOp.create({ opId: op.opId });
        ackedOpIds.push(op.opId);
      } catch (error) {
        console.error(`Error processing op ${op.opId}:`, error);
        errors.push({ opId: op.opId, error: error.message });
      }
    }

    res.json({
      ackedOpIds,
      errors: errors.length > 0 ? errors : undefined,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sync push error:', error);
    res.status(500).json({ error: 'Sync failed', details: error.message });
  }
});

// Pull data from server
router.get('/pull', authenticateToken, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);
    const scope = req.query.scope || 'ALL';

    const childrenQuery = { updatedAt: { $gte: since } };
    const visitsQuery = { createdAt: { $gte: since } };

    // Apply scope filtering (school or barangay)
    if (scope !== 'ALL') {
      // Try to parse as school or barangay
      const [type, value] = scope.split(':');
      if (type === 'school') {
        childrenQuery.school = value;
        // Get childIds for this school to filter visits
        const schoolChildren = await Child.find({ school: value }).select('childId');
        const childIds = schoolChildren.map(c => c.childId);
        visitsQuery.childId = { $in: childIds };
      } else if (type === 'barangay') {
        childrenQuery.barangay = value;
        const barangayChildren = await Child.find({ barangay: value }).select('childId');
        const childIds = barangayChildren.map(c => c.childId);
        visitsQuery.childId = { $in: childIds };
      }
    }

    const children = await Child.find(childrenQuery).lean();
    const visits = await Visit.find(visitsQuery).lean();
    
    // For clinic days and appointments, pull all records to ensure updates are synced
    // (since they don't have updatedAt fields, we can't filter by update time)
    const clinicDays = await ClinicDay.find({}).lean();
    const appointments = await Appointment.find({}).lean();

    // Remove old fields from visits (safety measure)
    const cleanedVisits = visits.map(visit => {
      const { referralFlag, dmft, DMFT, type, ...cleanVisit } = visit;
      return cleanVisit;
    });

    // Always include ALL current IDs for deletion detection (regardless of scope)
    // This allows immediate deletion sync when user clicks "Sync Now"
    const allChildIds = (await Child.find({}).select('childId').lean()).map(c => c.childId);
    const allVisitIds = (await Visit.find({}).select('visitId').lean()).map(v => v.visitId);
    const allClinicDayIds = (await ClinicDay.find({}).select('clinicDayId').lean()).map(c => c.clinicDayId);
    const allAppointmentIds = (await Appointment.find({}).select('appointmentId').lean()).map(a => a.appointmentId);

    res.json({
      children,
      visits: cleanedVisits,
      clinicDays,
      appointments,
      allChildIds, // All current child IDs on server (for deletion detection)
      allVisitIds, // All current visit IDs on server (for deletion detection)
      allClinicDayIds, // All current clinic day IDs on server (for deletion detection)
      allAppointmentIds, // All current appointment IDs on server (for deletion detection)
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sync pull error:', error);
    res.status(500).json({ error: 'Pull failed', details: error.message });
  }
});

export default router;
