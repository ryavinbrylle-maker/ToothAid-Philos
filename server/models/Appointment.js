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
    enum: ['SCHEDULED', 'ATTENDED', 'MISSED', 'RESCHEDULED', 'CANCELLED'],
    default: 'SCHEDULED',
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
  next();
});

// Pre-update hook for findOneAndUpdate
appointmentSchema.pre(['findOneAndUpdate', 'updateOne'], function(next) {
  if (this._update && this._update.createdAt && typeof this._update.createdAt === 'string') {
    this._update.createdAt = new Date(this._update.createdAt);
  }
  next();
});

// Compound indexes
appointmentSchema.index({ clinicDayId: 1, status: 1 });
appointmentSchema.index({ childId: 1, status: 1 });

export default mongoose.model('Appointment', appointmentSchema);
