const mongoose = require('mongoose');

const diseasePageSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    codes: {
        orphaCode: { type: String, default: '' },
        omim: { type: String, default: '' },
        icd10: { type: String, default: '' },
        snomed: { type: String, default: '' }
    },
    heroImageUrl: { type: String, default: '' },
    iconUrl: { type: String, default: '' },
    editors: [{ type: String, ref: 'User' }],
    linkedGroupIds: [{ type: String, ref: 'Group' }],
    featuredPostIds: [{ type: String, ref: 'Post' }],
    resourceLinks: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
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

module.exports = mongoose.model('DiseasePage', diseasePageSchema);
