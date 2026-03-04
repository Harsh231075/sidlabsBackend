const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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

// Simplified single-process server startup
function startServer() {
  // Connect to MongoDB
  connectDB();

  const app = express();
  const server = http.createServer(app);

  const AUDIT_LOGGER_ENABLED = String(process.env.AUDIT_LOGGER_ENABLED ?? '1') === '1';

  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://localhost:3001', 'https://winsights-social.sidlabs.net', 'https://winsights-patienthub.sidlabs.net'],
      credentials: true,
    })
  );
  app.use(compression({ level: 6, threshold: 1024 }));
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), {
    maxAge: '7d',
    immutable: true,
  }));

  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Winsights Social API' });
  });

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

  app.use('/api', responseCache());

  app.use('/api', AUDIT_LOGGER_ENABLED ? auditLogger() : (req, res, next) => next(), routes);

  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || err.statusCode || 500;
    const message = status < 500 ? err.message : (err.message || 'Internal server error');
    res.status(status).json({ error: message });
  });

  const io = initializeSocket(server);
  setIoInstance(io);

  server.listen({ port: PORT, backlog: Number.isFinite(LISTEN_BACKLOG) ? LISTEN_BACKLOG : 2048 }, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
    console.log(`WebSocket server ready`);
    console.log(`Audit logger enabled: ${AUDIT_LOGGER_ENABLED ? 'yes' : 'no'}`);

    const authProvider = process.env.AUTH_PROVIDER || 'local';
    const hasCognitoEnv = Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID);
    console.log(`Auth provider: ${authProvider}`);
    console.log(`Cognito configured: ${hasCognitoEnv ? 'yes' : 'no'}`);
  });

  const shutdown = () => {
    try {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    } catch (e) {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer();
