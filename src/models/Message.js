const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    convId: { type: String, ref: 'Conversation', required: true },
    senderId: { type: String, ref: 'User', required: true },
    text: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    moderation: { type: mongoose.Schema.Types.Mixed }, // { status, scores, flags, scannedAt }
    visible: { type: Boolean, default: true }
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

messageSchema.index({ convId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
