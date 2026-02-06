const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    privacy: { type: String, enum: ['public', 'private', 'hidden'], default: 'public' },
    ownerId: { type: String, ref: 'User', required: true },
    adminIds: [{ type: String, ref: 'User' }],
    members: [{ type: String, ref: 'User' }], // Array of user IDs
    memberCount: { type: Number, default: 0 },
    diseaseTag: { type: String, default: '' },
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

module.exports = mongoose.model('Group', groupSchema);
