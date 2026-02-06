require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const routes = require('./routes');
const { initializeSocket, setIoInstance } = require('./socket');
const path = require('path');
const connectDB = require('./db');
const auditLogger = require('./middleware/auditLogger');
const cookieParser =require ("cookie-parser");

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;

// app.use(cors());
app.use(
  cors({
    origin: ['http://localhost:3000','http://localhost:3001', 'https://winsights-social.sidlabs.net', 'https://winsights-patienthub.sidlabs.net'],
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Winsights Social API' });
});

app.use('/api', auditLogger(), routes);

app.use((err, req, res, next) => {
  // Basic error handler for development
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize Socket.io
const io = initializeSocket(server);
setIoInstance(io);

server.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
  console.log(`WebSocket server ready`);

  const authProvider = process.env.AUTH_PROVIDER || 'local';
  const hasCognitoEnv = Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID);
  console.log(`Auth provider: ${authProvider}`);
  console.log(`Cognito configured: ${hasCognitoEnv ? 'yes' : 'no'}`);
});
