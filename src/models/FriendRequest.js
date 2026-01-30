const mongoose = require('mongoose');

/**
 * FriendRequest Model
 *
 * from: requester userId
 * to: receiver userId
 * status: pending | accepted | rejected | cancelled
 */
const friendRequestSchema = new mongoose.Schema(
  {
    from: { type: String, ref: 'User', required: true },
    to: { type: String, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'cancelled'],
      default: 'pending',
      index: true,
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
  },
  {
    toJSON: {
      transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
    toObject: {
      transform: function (doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
      },
    },
  }
);

friendRequestSchema.index({ from: 1, to: 1, status: 1 });
// Prevent duplicate pending request in same direction
friendRequestSchema.index(
  { from: 1, to: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

friendRequestSchema.pre('save', function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model('FriendRequest', friendRequestSchema);
