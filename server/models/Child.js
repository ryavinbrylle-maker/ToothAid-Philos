import mongoose from 'mongoose';

const childSchema = new mongoose.Schema({
  childId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  /** Six-digit display / clinic ID; optional for legacy rows. */
  patientId: {
    type: String,
    trim: true,
    default: null,
    validate: {
      validator(v) {
        if (v == null || v === '') return true;
        return /^\d{6}$/.test(String(v).trim());
      }
    }
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  firstName: {
    type: String,
    trim: true,
    default: null
  },
  lastName: {
    type: String,
    trim: true,
    default: null
  },
  dob: {
    type: Date,
    default: null
  },
  age: {
    type: Number,
    default: null
  },
  sex: {
    type: String,
    enum: ['M', 'F', 'Other'],
    required: true
  },
  school: {
    type: String,
    required: true,
    trim: true
  },
  grade: {
    type: String,
    trim: true
  },
  class: {
    type: String,
    trim: true,
    default: null
  },
  barangay: {
    type: String,
    required: true,
    trim: true
  },
  guardianPhone: {
    type: String,
    trim: true,
    default: null
  },
  messenger: {
    type: String,
    trim: true,
    default: null
  },
  priority: {
    type: String,
    enum: ['P0', 'P1', 'P2', 'P3'],
    default: 'P2',
    index: true
  },
  consentGeneralReceivedAt: {
    type: Date,
    default: null
  },
  consentSpecific: {
    type: [
      {
        procedure: { type: String, trim: true, required: true },
        date: { type: Date, default: null }
      }
    ],
    default: []
  },
  notes: {
    type: String,
    trim: true,
    default: null
  },
  // Per-tooth FDI keys, e.g. "16": { condition: "sound"|"decayed"|..., updatedAt: Date }
  toothStates: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  updatedBy: {
    type: String,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Compound index for duplicate detection
childSchema.index({ school: 1, fullName: 1 });
childSchema.index({ school: 1, dob: 1 });
childSchema.index(
  { patientId: 1 },
  {
    unique: true,
    partialFilterExpression: { patientId: { $exists: true, $regex: /^[0-9]{6}$/ } }
  }
);

// Update updatedAt on save
childSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Child', childSchema);
