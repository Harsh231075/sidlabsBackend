const mongoose = require('mongoose');

const forumPostSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    threadId: { type: String, ref: 'ForumThread', required: true },
    authorId: { type: String, ref: 'User', required: true },
    content: { type: String, required: true },
    repliedToUserId: { type: String, ref: 'User', default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    removed: { type: Boolean, default: false },
    removedAt: { type: Date },
    moderation: { type: mongoose.Schema.Types.Mixed }
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

module.exports = mongoose.model('ForumPost', forumPostSchema);
