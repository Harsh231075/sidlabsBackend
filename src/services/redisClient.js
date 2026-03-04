const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let client = null;
let ready = false;
let usingFallback = false;

class LRUMap {
  constructor(max = 5000) {
    this.max = max;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return undefined;
    const v = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.max) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    this.cache.set(key, value);
  }
  del(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
}

const fallbackLRU = new LRUMap(5000);

function getClient() {
  if (client) return client;

  client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
    enableOfflineQueue: false,
  });

  client.on('connect', () => {
    ready = true;
    usingFallback = false;
    console.log('[Redis] connected');
  });

  client.on('error', (err) => {
    if (ready) console.warn('[Redis] connection lost, falling back to in-memory cache');
    ready = false;
    usingFallback = true;
  });

  client.on('close', () => {
    ready = false;
    usingFallback = true;
  });

  client.connect().catch(() => {
    usingFallback = true;
    console.warn('[Redis] unavailable — using in-memory LRU fallback');
  });

  return client;
}

async function safeGet(key) {
  if (!ready) return fallbackLRU.get(key) ?? null;
  try {
    return await client.get(key);
  } catch {
    return fallbackLRU.get(key) ?? null;
  }
}

async function safeSet(key, value, ttlSeconds) {
  fallbackLRU.set(key, value);
  if (!ready) return;
  try {
    if (ttlSeconds) {
      await client.set(key, value, 'EX', ttlSeconds);
    } else {
      await client.set(key, value);
    }
  } catch { }
}

async function safeDel(key) {
  fallbackLRU.del(key);
  if (!ready) return;
  try { await client.del(key); } catch { }
}

async function safeDelPattern(pattern) {
  fallbackLRU.clear();
  if (!ready) return;
  try {
    const stream = client.scanStream({ match: pattern, count: 200 });
    stream.on('data', (keys) => {
      if (keys.length) client.del(...keys).catch(() => { });
    });
  } catch { }
}

function isReady() { return ready; }
function isFallback() { return usingFallback; }

getClient();

module.exports = {
  getClient,
  safeGet,
  safeSet,
  safeDel,
  safeDelPattern,
  isReady,
  isFallback,
};
