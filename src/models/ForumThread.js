const mongoose = require('mongoose');

const forumThreadSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    title: { type: String, required: true },
    creatorId: { type: String, ref: 'User', required: true },
    groupId: { type: String, ref: 'Group', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    removed: { type: Boolean, default: false },
    removedBy: { type: String, ref: 'User' },
    removedAt: { type: Date }
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

module.exports = mongoose.model('ForumThread', forumThreadSchema);
