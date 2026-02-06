const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    eventDate: { type: String, required: true }, // Format 'YYYY-MM-DD' ?? or Date object? JSON has "2025-01-25" string
    eventTime: { type: String, required: true },
    location: { type: String, default: '' },
    eventType: { type: String, enum: ['virtual', 'in-person', 'hybrid'], default: 'virtual' },
    registrationUrl: { type: String, default: '' },
    diseasePageSlug: { type: String, default: null }, // or Ref? JSON has null or string
    maxAttendees: { type: Number, default: 100 },
    attendees: [{ type: String, ref: 'User' }], // Array of User IDs
    createdBy: { type: String, ref: 'User' },
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

module.exports = mongoose.model('Event', eventSchema);
