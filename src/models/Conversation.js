const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    participantIds: [{ type: String, ref: 'User' }],
    isGroup: { type: Boolean, default: false },
    name: { type: String, default: null },
    createdBy: { type: String, ref: 'User' },
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

module.exports = mongoose.model('Conversation', conversationSchema);
