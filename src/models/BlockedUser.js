const mongoose = require('mongoose');

const blockedUserSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    blockerId: { type: String, ref: 'User', required: true },
    blockedId: { type: String, ref: 'User', required: true },
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

// ─── Performance indexes ────────────────────────────────────────────
blockedUserSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockedUserSchema.index({ blockedId: 1 });

module.exports = mongoose.model('BlockedUser', blockedUserSchema);
