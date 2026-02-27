const mongoose = require('mongoose');

const badgeDefinitionSchema = new mongoose.Schema({
    badgeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    criteria: {
        actionType: { type: String, required: true },
        threshold: { type: Number, required: true }
    },
    imageUrl: { type: String, required: true },
    tokenReward: { type: Number, required: true },
    isNFT: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, {
    toJSON: {
        transform: function (doc, ret) {
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

module.exports = mongoose.model('BadgeDefinition', badgeDefinitionSchema);
