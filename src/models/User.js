const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    cognitoSub: { type: String, unique: true, sparse: true }, // AWS Cognito user ID (sub claim)
    username: { type: String, unique: true, sparse: true }, // Unique username for profile URL
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: false }, // Optional when using Cognito auth
    role: { type: String, enum: ['admin-user', 'moderator-user', 'patient-user', 'caregiver-user', 'researcher-user'], default: 'patient-user' },
    roleType: { type: String, enum: ['admin', 'moderator', 'patient', 'caregiver', 'researcher'], default: 'patient' },
    authProvider: { type: String, enum: ['local', 'cognito'], default: 'local' }, // Track auth method
    isPatient: { type: Boolean, default: false },
    disease: { type: String, default: '' },
    caregiverRelationship: { type: String, default: '' },
    location: { type: String, default: '' },
    bio: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    coverPhotoUrl: { type: String, default: '' }, // Cover photo for profile
    healthInterests: [{ type: String }], // Health interest tags
    suspended: { type: Boolean, default: false },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
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

module.exports = mongoose.model('User', userSchema);
