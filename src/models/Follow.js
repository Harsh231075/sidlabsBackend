const mongoose = require('mongoose');

/**
 * Follow Model - Tracks user follow relationships
 * 
 * follower: The user who is following
 * following: The user being followed
 */
const followSchema = new mongoose.Schema({
  follower: { type: String, ref: 'User', required: true },
  following: { type: String, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
}, {
  toJSON: {
    transform: function (doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    }
  },
  toObject: {
    transform: function (doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
    }
  }
});

// Compound index to prevent duplicate follows
followSchema.index({ follower: 1, following: 1 }, { unique: true });

// Index for efficient queries
followSchema.index({ follower: 1 });
followSchema.index({ following: 1 });

module.exports = mongoose.model('Follow', followSchema);
