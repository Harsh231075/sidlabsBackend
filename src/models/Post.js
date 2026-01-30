const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    authorId: { type: String, ref: 'User', required: true },
    content: { type: String, default: '' },
    mediaUrl: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    likes: [{ type: String, ref: 'User' }],
    reported: { type: Boolean, default: false },
    reports: [{ type: String }], // Array of report objects or strings? Checking JSONs later if needed, assuming simple for now or Mixed
    removed: { type: Boolean, default: false },
    removedBy: { type: String, ref: 'User' },
    removedAt: { type: Date },
    moderation: { type: mongoose.Schema.Types.Mixed }, // Dynamic object
    moderationStatus: { type: String }, // redundant with moderation.status?
    visible: { type: Boolean, default: true },
    groupId: { type: String, ref: 'Group', default: null } // Saw this in posts.json
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

postSchema.index({ removed: 1, createdAt: -1, _id: -1 });
postSchema.index({ groupId: 1, removed: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model('Post', postSchema);
