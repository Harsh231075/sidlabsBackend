const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    userId: { type: String, ref: 'User', required: true },
    type: { type: String, required: true }, // e.g. 'like', 'comment'
    message: { type: String, required: true },
    entityId: { type: String, default: null }, // ID of the related entity (post, etc)
    entityType: { type: String, default: null }, // 'post', 'comment', etc
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
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

module.exports = mongoose.model('Notification', notificationSchema);
