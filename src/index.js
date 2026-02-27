const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const cluster = require('cluster');
const os = require('os');

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const routes = require('./routes');
const { initializeSocket, setIoInstance } = require('./socket');
const connectDB = require('./db');
const auditLogger = require('./middleware/auditLogger');
const responseCache = require('./middleware/responseCache');
const cookieParser = require('cookie-parser');
const redis = require('./services/redisClient');

const PORT = process.env.PORT || 5001;
const LISTEN_BACKLOG = Number(process.env.LISTEN_BACKLOG || 2048);

function parseClusterWorkers(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === '0' || v === 'false' || v === 'off') return 1;
  if (v === 'auto' || v === 'max') return Math.max(1, os.cpus().length);
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.floor(n);
}

const CLUSTER_WORKERS = parseClusterWorkers(process.env.CLUSTER_WORKERS);

function startWorker() {
  // Connect to MongoDB (per worker)
  connectDB();

  const app = express();
  const server = http.createServer(app);

  // Server-level tuning (helps under high concurrency / keep-alive behavior).
  // Keep headersTimeout slightly above keepAliveTimeout to avoid premature socket closes.
  const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 65000);
  const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS || 66000);
  const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

  if (Number.isFinite(KEEP_ALIVE_TIMEOUT_MS)) server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  if (Number.isFinite(HEADERS_TIMEOUT_MS)) server.headersTimeout = HEADERS_TIMEOUT_MS;
  if (Number.isFinite(REQUEST_TIMEOUT_MS)) server.requestTimeout = REQUEST_TIMEOUT_MS;

  const AUDIT_LOGGER_ENABLED = String(process.env.AUDIT_LOGGER_ENABLED ?? '1') === '1';

  // app.use(cors());
  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:3001', 'https://winsights-social.sidlabs.net', 'https://winsights-patienthub.sidlabs.net'],
      credentials: true,
    })
  );
  // gzip/brotli compression — cuts JSON payload sizes 60-80%
  app.use(compression({ level: 6, threshold: 1024 }));
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // Serve uploaded files (with long cache for static assets)
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: '7d',
    immutable: true,
  }));

  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Winsights Social API' });
  });

  // Health check with subsystem status
  app.get('/health', (req, res) => {
    const mongoose = require('mongoose');
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      redis: redis.isReady() ? 'connected' : (redis.isFallback() ? 'fallback-lru' : 'disconnected'),
      pid: process.pid,
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
    });
  });

  // Response-level Redis cache for GET endpoints (short TTL, huge impact under concurrent load)
  app.use('/api', responseCache());

  app.use('/api', AUDIT_LOGGER_ENABLED ? auditLogger() : (req, res, next) => next(), routes);

  app.use((err, req, res, next) => {
    // Basic error handler for development
    console.error(err);
    const status = err.status || err.statusCode || 500;
    // Send the error message to the client, especially for 4xx errors
    const message = status < 500 ? err.message : (err.message || 'Internal server error');
    res.status(status).json({ error: message });
  });

  // Initialize Socket.io
  // NOTE: In multi-worker cluster mode, Socket.IO presence/state is per worker unless using sticky sessions + shared adapter.
  const io = initializeSocket(server);
  setIoInstance(io);

  server.listen({ port: PORT, backlog: Number.isFinite(LISTEN_BACKLOG) ? LISTEN_BACKLOG : 2048 }, () => {
    const workerLabel = cluster.isWorker ? ` (worker ${cluster.worker?.id}, pid ${process.pid})` : '';
    console.log(`API server listening on http://localhost:${PORT}${workerLabel}`);
    console.log(`WebSocket server ready${workerLabel}`);
    console.log(`Audit logger enabled: ${AUDIT_LOGGER_ENABLED ? 'yes' : 'no'}`);
    console.log(`HTTP keepAliveTimeout: ${server.keepAliveTimeout}ms`);
    console.log(`HTTP headersTimeout: ${server.headersTimeout}ms`);
    console.log(`HTTP requestTimeout: ${server.requestTimeout}ms`);
    console.log(`HTTP listen backlog: ${Number.isFinite(LISTEN_BACKLOG) ? LISTEN_BACKLOG : 2048}`);

    const authProvider = process.env.AUTH_PROVIDER || 'local';
    const hasCognitoEnv = Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID);
    console.log(`Auth provider: ${authProvider}`);
    console.log(`Cognito configured: ${hasCognitoEnv ? 'yes' : 'no'}`);
    if (CLUSTER_WORKERS > 1) {
      console.log(`Cluster workers: ${CLUSTER_WORKERS}`);
    }
  });

  const shutdown = () => {
    try {
      server.close(() => process.exit(0));
      // Force exit if close hangs
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (e) {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (CLUSTER_WORKERS > 1 && cluster.isPrimary) {
  console.log(`Starting clustered API server: ${CLUSTER_WORKERS} workers on port ${PORT}`);
  for (let i = 0; i < CLUSTER_WORKERS; i += 1) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker ${worker?.id} (pid ${worker?.process?.pid}) exited (code=${code} signal=${signal}). Restarting...`);
    cluster.fork();
  });

  const shutdownPrimary = () => {
    console.log('Primary shutting down, terminating workers...');
    for (const id in cluster.workers) {
      const w = cluster.workers[id];
      if (w) w.process.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdownPrimary);
  process.on('SIGTERM', shutdownPrimary);
} else {
  startWorker();
}
