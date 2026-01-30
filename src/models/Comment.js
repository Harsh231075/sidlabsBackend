const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    postId: { type: String, ref: 'Post', required: true },
    authorId: { type: String, ref: 'User', required: true },
    content: { type: String, required: true },
    parentCommentId: { type: String, ref: 'Comment', default: null },
    createdAt: { type: Date, default: Date.now },
    removed: { type: Boolean, default: false },
    moderation: { type: mongoose.Schema.Types.Mixed },
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

commentSchema.index({ postId: 1, removed: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Comment', commentSchema);
