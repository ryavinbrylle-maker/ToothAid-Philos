import mongoose from 'mongoose';

const visitSchema = new mongoose.Schema({
  visitId: {
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
  date: {
    type: Date,
    required: true,
    index: true
  },
  painFlag: {
    type: Boolean,
    default: false
  },
  swellingFlag: {
    type: Boolean,
    default: false
  },
  /** Symptom name → days (client); legacy visits may omit */
  symptoms: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  /** Examination section notes (separate from visit notes) */
  examinationNotes: {
    type: String,
    default: null
  },
  /** [{ toothNumber, treatments: string[] }] — per-tooth treatments without examination status */
  toothSpecificTreatments: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  decayedTeeth: {
    type: Number,
    default: null
  },
  missingTeeth: {
    type: Number,
    default: null
  },
  filledTeeth: {
    type: Number,
    default: null
  },
  /** PERMANENT | PRIMARY — used for charts; optional for legacy rows */
  dentition: {
    type: String,
    default: null
  },
  /** FDI tooth key → { condition, note? } — client-authored examination snapshot */
  toothRecords: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  toothExaminations: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  treatmentTypes: {
    type: [String],
    default: []
  },
  /** Visit Entry: per-visit treatment labels (e.g. Cleaning, Filling). */
  treatments: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  medications: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  chiefComplaint: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: null
  },
  behaviourFrankl: {
    type: Number,
    default: null
  },
  requiresFollowUp: {
    type: Boolean,
    default: false
  },
  followUpPriority: {
    type: String,
    default: null
  },
  followUpDueAt: {
    type: Date,
    default: null
  },
  updatedBy: {
    type: String,
    default: null,
    trim: true
  },
  updatedAt: {
    type: Date,
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
  strict: true // Only allow fields defined in schema
});

// Pre-save hook to remove old fields (extra safety)
visitSchema.pre('save', function(next) {
  // Remove old fields if they somehow exist
  if (this.isNew || this.isModified()) {
    delete this.referralFlag;
    delete this.dmft;
    delete this.DMFT;
  }
  next();
});

// Pre-update hook to remove old fields
visitSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function(next) {
  // Remove old fields from update operations
  if (this._update) {
    delete this._update.referralFlag;
    delete this._update.dmft;
    delete this._update.DMFT;
  }
  next();
});

// Compound index for child visits
visitSchema.index({ childId: 1, date: -1 });

export default mongoose.model('Visit', visitSchema);
