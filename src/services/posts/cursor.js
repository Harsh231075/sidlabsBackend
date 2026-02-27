function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function encodeCursor(createdAt, id) {
  // Use ISO timestamp + id to keep ordering stable.
  return Buffer.from(`${new Date(createdAt).toISOString()}|${id}`, 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const decoded = Buffer.from(String(cursor), 'base64').toString('utf8');
    const [iso, id] = decoded.split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

module.exports = {
  parsePositiveInt,
  encodeCursor,
  decodeCursor,
};
