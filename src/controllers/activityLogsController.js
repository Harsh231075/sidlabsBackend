const ActivityLog = require('../models/ActivityLog');

async function listActivityLogs(req, res, next) {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10), 1), 100);
    const skip = (page - 1) * limit;

    const { actorUserId, action, method, path, success, q, fromDate, toDate, resource } = req.query;

    const filter = {};

    // Date range filter
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate) {
        const from = new Date(fromDate);
        from.setHours(0, 0, 0, 0);
        filter.createdAt.$gte = from;
      }
      if (toDate) {
        const to = new Date(toDate);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    if (actorUserId) filter.actorUserId = String(actorUserId);
    if (action) filter.action = String(action).toUpperCase();
    if (method) filter.method = String(method).toUpperCase();
    if (path) filter.path = { $regex: String(path), $options: 'i' };
    if (resource) filter.resource = { $regex: String(resource), $options: 'i' };
    if (typeof success !== 'undefined') {
      if (success === 'true' || success === true) filter.success = true;
      if (success === 'false' || success === false) filter.success = false;
    }

    if (q) {
      const queryText = String(q);
      filter.$or = [
        { path: { $regex: queryText, $options: 'i' } },
        { ip: { $regex: queryText, $options: 'i' } },
        { 'actor.email': { $regex: queryText, $options: 'i' } },
        { 'actor.name': { $regex: queryText, $options: 'i' } },
        { 'actor.username': { $regex: queryText, $options: 'i' } },
        { resource: { $regex: queryText, $options: 'i' } },
        { resourceId: { $regex: queryText, $options: 'i' } },
        { description: { $regex: queryText, $options: 'i' } },
        { targetName: { $regex: queryText, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
}

// Delete logs by date range (admin only)
async function deleteLogsByRange(req, res, next) {
  try {
    const { fromDate, toDate, logIds } = req.body;

    let filter = {};
    let deleteCount = 0;

    // If specific log IDs provided, delete those
    if (logIds && Array.isArray(logIds) && logIds.length > 0) {
      const result = await ActivityLog.deleteMany({ _id: { $in: logIds } });
      deleteCount = result.deletedCount;
    }
    // Otherwise use date range
    else if (fromDate && toDate) {
      const from = new Date(fromDate);
      from.setHours(0, 0, 0, 0);
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);

      filter.createdAt = { $gte: from, $lte: to };
      const result = await ActivityLog.deleteMany(filter);
      deleteCount = result.deletedCount;
    }
    // Delete all logs older than specified date
    else if (fromDate) {
      const from = new Date(fromDate);
      filter.createdAt = { $lte: from };
      const result = await ActivityLog.deleteMany(filter);
      deleteCount = result.deletedCount;
    }
    else {
      return res.status(400).json({ error: 'Please provide date range or log IDs' });
    }

    res.json({
      success: true,
      deletedCount: deleteCount,
      message: `Successfully deleted ${deleteCount} log entries`
    });
  } catch (err) {
    next(err);
  }
}

// Delete single log
async function deleteLog(req, res, next) {
  try {
    const { id } = req.params;
    const result = await ActivityLog.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json({ success: true, message: 'Log deleted successfully' });
  } catch (err) {
    next(err);
  }
}

// Get log statistics
async function getLogStats(req, res, next) {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      total,
      last24hCount,
      last7dCount,
      last30dCount,
      byAction,
      byResource,
      failedCount,
    ] = await Promise.all([
      ActivityLog.countDocuments(),
      ActivityLog.countDocuments({ createdAt: { $gte: last24h } }),
      ActivityLog.countDocuments({ createdAt: { $gte: last7d } }),
      ActivityLog.countDocuments({ createdAt: { $gte: last30d } }),
      ActivityLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      ActivityLog.aggregate([
        { $group: { _id: '$resource', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      ActivityLog.countDocuments({ success: false }),
    ]);

    res.json({
      total,
      last24h: last24hCount,
      last7d: last7dCount,
      last30d: last30dCount,
      byAction: byAction.reduce((acc, item) => ({ ...acc, [item._id || 'OTHER']: item.count }), {}),
      topResources: byResource.map(r => ({ resource: r._id || 'unknown', count: r.count })),
      failedCount,
      successRate: total > 0 ? (((total - failedCount) / total) * 100).toFixed(1) : 100,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listActivityLogs, deleteLogsByRange, deleteLog, getLogStats };
