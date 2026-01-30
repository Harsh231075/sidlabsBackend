const mongoose = require('mongoose');

const gamificationSchema = new mongoose.Schema({
    userId: { type: String, ref: 'User', required: true, unique: true }, // Using userId as lookup, but Mongo will generate _id for document
    totalTokens: { type: Number, default: 0 },
    tokenHistory: [
        {
            id: { type: String }, // UUID from JSON
            action: { type: String },
            tokens: { type: Number },
            timestamp: { type: Date },
            metadata: { type: mongoose.Schema.Types.Mixed }
        }
    ],
    badges: [
        {
            badgeId: { type: String },
            minted: { type: Boolean, default: false },
            mintedAt: { type: Date },
            nftTokenId: { type: String, default: null },
            nftContractAddress: { type: String, default: null }
        }
    ],
    actionCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    toJSON: {
        transform: function (doc, ret) {
            // ret.id = ret._id; // Default Mongo ID
            delete ret._id;
            delete ret.__v;
        }
    },
    toObject: {
        transform: function (doc, ret) {
            // ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
        }
    }
});

module.exports = mongoose.model('Gamification', gamificationSchema);
