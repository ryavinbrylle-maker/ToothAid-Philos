import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
  appointmentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  childId: {
    type: String,
    required: true,
    index: true
  },
  clinicDayId: {
    type: String,
    required: true,
    index: true
  },
  timeWindow: {
    type: String,
    enum: ['AM', 'PM', 'FULL'],
    default: 'FULL'
  },
  slotNumber: {
    type: Number,
    default: null
  },
  reason: {
    type: String,
    enum: ['EMERGENCY', 'HIGH_PRIORITY', 'FOLLOW_UP', 'ROUTINE'],
    default: 'ROUTINE'
  },
  status: {
    type: String,
    enum: ['TO_BE_SCHEDULED', 'SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED', 'CANCELLED'],
    default: 'SCHEDULED',
    index: true
  },
  statusChangedAt: {
    type: Date,
    default: null
  },
  statusChangedBy: {
    type: String,
    default: null
  },
  statusReason: {
    type: String,
    default: null
  },
  followUpNeeded: {
    type: Boolean,
    default: false,
    index: true
  },
  followUpDueAt: {
    type: Date,
    default: null
  },
  followUps: {
    type: [
      {
        reminderId: { type: String, required: true },
        type: { type: String, default: 'REMINDER' },
        reason: { type: String, default: null },
        dueAt: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
        createdBy: { type: String, default: null },
        completedAt: { type: Date, default: null },
        completedBy: { type: String, default: null }
      }
    ],
    default: []
  },
  contactLogs: {
    type: [
      {
        contactId: { type: String, required: true },
        channel: { type: String, default: 'SMS' },
        direction: { type: String, default: 'OUTBOUND' },
        outcome: { type: String, default: null },
        note: { type: String, default: null },
        createdAt: { type: Date, default: Date.now },
        createdBy: { type: String, default: null }
      }
    ],
    default: []
  },
  rescheduledFromAppointmentId: {
    type: String,
    default: null,
    index: true
  },
  rescheduledToAppointmentId: {
    type: String,
    default: null,
    index: true
  },
  /** Display order within the same clinicDayId + timeWindow (0-based). */
  order: {
    type: Number,
    default: null
  },
  /** Client priority label e.g. P0–P3 */
  priority: {
    type: String,
    default: null
  },
  note: {
    type: String,
    default: null
  },
  /** Scheduled procedure e.g. Cleaning, Filling, or custom text */
  procedureType: {
    type: String,
    default: null,
    trim: true
  },
  /** Date the patient was contacted (YYYY-MM-DD). Used to order the waiting list oldest-first. */
  contactDate: {
    type: String,
    default: null,
    trim: true
  },
  priorityTier: {
    type: Number,
    default: null
  },
  createdBy: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'appointments'
});

// Pre-save hook to ensure createdAt is a Date object
appointmentSchema.pre('save', function(next) {
  if (this.createdAt && typeof this.createdAt === 'string') {
    this.createdAt = new Date(this.createdAt);
  }
  if (this.statusChangedAt && typeof this.statusChangedAt === 'string') {
    this.statusChangedAt = new Date(this.statusChangedAt);
  }
  if (this.followUpDueAt && typeof this.followUpDueAt === 'string') {
    this.followUpDueAt = new Date(this.followUpDueAt);
  }
  next();
});

// Pre-update hook for findOneAndUpdate
appointmentSchema.pre(['findOneAndUpdate', 'updateOne'], function(next) {
  if (this._update && this._update.createdAt && typeof this._update.createdAt === 'string') {
    this._update.createdAt = new Date(this._update.createdAt);
  }
  if (this._update && this._update.statusChangedAt && typeof this._update.statusChangedAt === 'string') {
    this._update.statusChangedAt = new Date(this._update.statusChangedAt);
  }
  if (this._update && this._update.followUpDueAt && typeof this._update.followUpDueAt === 'string') {
    this._update.followUpDueAt = new Date(this._update.followUpDueAt);
  }
  next();
});

// Compound indexes
appointmentSchema.index({ clinicDayId: 1, status: 1 });
appointmentSchema.index({ childId: 1, status: 1 });

export default mongoose.model('Appointment', appointmentSchema);
