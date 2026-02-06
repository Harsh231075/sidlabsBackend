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
    reports: [{
        reporterId: { type: String, ref: 'User' },
        reason: { type: String },
        reportedAt: { type: Date, default: Date.now }
    }],
    removed: { type: Boolean, default: false },
    removedBy: { type: String, ref: 'User' },
    removedAt: { type: Date },
    moderation: { type: mongoose.Schema.Types.Mixed }, // Dynamic object
    moderationStatus: { type: String }, // redundant with moderation.status?
    visible: { type: Boolean, default: true },
    groupId: { type: String, ref: 'Group', default: null }, // Saw this in posts.json
    diseasePageSlug: { type: String, ref: 'DiseasePage', default: null } // For disease page posts
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
postSchema.index({ authorId: 1, removed: 1, createdAt: -1, _id: -1 }); // Index for author feed
postSchema.index({ groupId: 1, removed: 1, createdAt: -1, _id: -1 });
postSchema.index({ diseasePageSlug: 1, removed: 1, createdAt: -1, _id: -1 }); // Index for disease page posts

module.exports = mongoose.model('Post', postSchema);
