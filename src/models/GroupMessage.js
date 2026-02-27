const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // uuid
    groupId: { type: String, ref: 'Group', required: true },
    senderId: { type: String, ref: 'User', required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    // Optional: attachments, mentions, etc.
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

// Index for efficient pagination of chat history
groupMessageSchema.index({ groupId: 1, createdAt: -1 });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
