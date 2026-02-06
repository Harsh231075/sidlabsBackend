const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema({
    userId: { type: String, ref: 'User', required: true, unique: true },
    emailComments: { type: Boolean, default: true },
    emailLikes: { type: Boolean, default: true },
    emailGroupPosts: { type: Boolean, default: true },
    emailForumReplies: { type: Boolean, default: true },
    emailEventReminders: { type: Boolean, default: true },
    emailPatientHubTasks: { type: Boolean, default: true }
}, {
    toJSON: {
        transform: function (doc, ret) {
            // No ID usually exposed for prefs, just per user
            delete ret._id;
            delete ret.__v;
        }
    },
    toObject: {
        transform: function (doc, ret) {
            delete ret._id;
            delete ret.__v;
        }
    }
});

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
