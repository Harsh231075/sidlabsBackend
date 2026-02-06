const mongoose = require('mongoose');

const diseaseFollowerSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    diseasePageSlug: { type: String, required: true, ref: 'DiseasePage', localField: 'diseasePageSlug', foreignField: 'slug' }, // This ref is tricky with slug, maybe just store as string and query manually if needed, or stick to user pattern
    userId: { type: String, ref: 'User', required: true },
    followedAt: { type: Date, default: Date.now }
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

// Since we reference by slug, simple ref might not work directly out of box like ObjectId, but for now we keep schema simple.
module.exports = mongoose.model('DiseaseFollower', diseaseFollowerSchema);
