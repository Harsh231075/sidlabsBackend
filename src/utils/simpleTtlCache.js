class SimpleTtlCache {
  constructor({ defaultTtlMs = 0, maxEntries = 1000 } = {}) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  _now() {
    return Date.now();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt && entry.expiresAt <= this._now()) {
      this.map.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key, value, ttlMs) {
    const ttl = Number.isFinite(ttlMs) ? ttlMs : this.defaultTtlMs;
    const expiresAt = ttl > 0 ? this._now() + ttl : 0;

    // Basic max size guard: evict oldest entry.
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }

    this.map.set(key, { value, expiresAt });
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

module.exports = { SimpleTtlCache };
