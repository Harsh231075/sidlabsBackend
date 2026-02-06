const mongoose = require('mongoose');

const badgeSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    userId: { type: String, ref: 'User', required: true },
    type: { type: String, required: true }, // Should match BadgeDefinition.badgeId
    name: { type: String, required: true },
    awardedAt: { type: Date, default: Date.now }
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

module.exports = mongoose.model('Badge', badgeSchema);
