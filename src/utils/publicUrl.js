function toPublicUrl(value) {
  if (!value) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  // If it's already an absolute URL, keep as-is.
  if (/^https?:\/\//i.test(raw)) return raw;

  // Normalize path: allow values like 'uploads/a.jpg' or '/uploads/a.jpg'
  const normalizedPath = raw.startsWith('/') ? raw.slice(1) : raw;

  const base = (process.env.BASE_URL || '').trim();
  if (!base) {
    // Local/dev fallback: keep as relative to current origin.
    return raw.startsWith('/') ? raw : `/${raw}`;
  }

  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}/${normalizedPath}`;
}

module.exports = { toPublicUrl };
