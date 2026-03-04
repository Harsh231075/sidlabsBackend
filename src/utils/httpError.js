/**
 * Shared HTTP error helper for service layers.
 *
 * Usage in services:
 *   throw httpError(400, { error: 'Content is required' });
 *
 * Caught in controllers:
 *   if (err.responseBody) return res.status(err.status).json(err.responseBody);
 *   next(err);
 */
function httpError(status, body) {
  const message = typeof body === 'string' ? body : (body?.error || body?.message || 'Error');
  const err = new Error(message);
  err.status = status;
  if (typeof body === 'object') err.responseBody = body;
  return err;
}

module.exports = { httpError };
