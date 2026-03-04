const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: String, ref: 'User' },
    actor: {
      id: { type: String },
      name: { type: String },
      email: { type: String },
      username: { type: String },
      role: { type: String },
    },

    action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE', 'OTHER'], default: 'OTHER' },
    method: { type: String },
    path: { type: String },

    resource: { type: String },
    resourceId: { type: String },

    // Enhanced details for better logging
    description: { type: String },
    targetName: { type: String },
    changes: { type: mongoose.Schema.Types.Mixed },
    requestBody: { type: mongoose.Schema.Types.Mixed },

    statusCode: { type: Number },
    success: { type: Boolean, default: false },

    ip: { type: String },
    realIp: { type: String }, // Store the real IP separately
    geo: {
      country: { type: String },
      countryName: { type: String },
      region: { type: String },
      regionName: { type: String },
      city: { type: String },
      ll: { type: [Number] },
      timezone: { type: String },
      isp: { type: String },
    },

    userAgent: { type: String },
    browser: { type: String },
    os: { type: String },
    device: { type: String },

    params: { type: mongoose.Schema.Types.Mixed },
    query: { type: mongoose.Schema.Types.Mixed },
    bodyKeys: { type: [String], default: [] },

    errorMessage: { type: String },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

// Compound indexes (covers admin listing + filtering + date-range)
activityLogSchema.index({ createdAt: -1 }); // primary sort
activityLogSchema.index({ actorUserId: 1, createdAt: -1 }); // per-user logs
activityLogSchema.index({ resource: 1, action: 1, createdAt: -1 }); // filtered view

module.exports = mongoose.model('ActivityLog', activityLogSchema);
