import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  icon: {
    type: String,
    default: 'Wrench' // Lucide icon name
  },
  image: {
    type: String,
    default: null // URL to service image
  },
  price: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  estimatedDuration: {
    type: String, // e.g., "2-3 hours"
    default: null
  },
  requirements: [{
    type: String // List of requirements/tools needed
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
serviceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for search
serviceSchema.index({ name: 'text', description: 'text', category: 'text' });

const Service = mongoose.models.Service || mongoose.model('Service', serviceSchema);
export default Service;
