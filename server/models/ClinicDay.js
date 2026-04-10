import mongoose from 'mongoose';

const clinicDaySchema = new mongoose.Schema({
  clinicDayId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  date: {
    type: Date,
    required: true,
    index: true
  },
  school: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  capacity: {
    type: Number,
    required: true,
    min: 0
  },
  amCapacity: {
    type: Number,
    default: null
  },
  pmCapacity: {
    type: Number,
    default: null
  },
  notes: {
    type: String,
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
  collection: 'clinicdays'
});

// Pre-save hook to ensure date is a Date object
clinicDaySchema.pre('save', function(next) {
  if (this.date && typeof this.date === 'string') {
    this.date = new Date(this.date);
  }
  if (this.createdAt && typeof this.createdAt === 'string') {
    this.createdAt = new Date(this.createdAt);
  }
  next();
});

// Pre-update hook for findOneAndUpdate
clinicDaySchema.pre(['findOneAndUpdate', 'updateOne'], function(next) {
  if (this._update && this._update.date && typeof this._update.date === 'string') {
    this._update.date = new Date(this._update.date);
  }
  if (this._update && this._update.createdAt && typeof this._update.createdAt === 'string') {
    this._update.createdAt = new Date(this._update.createdAt);
  }
  next();
});

export default mongoose.model('ClinicDay', clinicDaySchema);
