const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: String, ref: 'User', index: true },
    actor: {
      id: { type: String },
      name: { type: String },
      email: { type: String },
      username: { type: String },
      role: { type: String },
    },

    action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE', 'OTHER'], default: 'OTHER', index: true },
    method: { type: String, index: true },
    path: { type: String, index: true },

    resource: { type: String },
    resourceId: { type: String },

    // Enhanced details for better logging
    description: { type: String }, // Human readable description like "Updated post title"
    targetName: { type: String }, // Name of the target resource (e.g., post title, user name)
    changes: { type: mongoose.Schema.Types.Mixed }, // What fields were changed
    requestBody: { type: mongoose.Schema.Types.Mixed }, // Sanitized request body (no passwords)

    statusCode: { type: Number, index: true },
    success: { type: Boolean, default: false, index: true },

    ip: { type: String, index: true },
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

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ createdAt: 1 }); // For date range queries

module.exports = mongoose.model('ActivityLog', activityLogSchema);
