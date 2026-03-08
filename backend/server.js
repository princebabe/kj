'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const path     = require('path');

const { general: generalLimiter } = require('./middleware/rateLimiter');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes   = require('./routes/auth');
const emailRoutes  = require('./routes/emails');
const inboxRoutes  = require('./routes/inbox');
const adminRoutes  = require('./routes/admin');
const apiRoutes    = require('./routes/api');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Trust proxy (for rate limiter IP detection) ──────────────────────────────
app.set('trust proxy', 1);

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:      ["'self'", 'data:', 'https:'],
      connectSrc:  ["'self'"],
    },
  },
}));

app.use(cors({
  origin:      process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── General rate limit ───────────────────────────────────────────────────────
app.use('/api/', generalLimiter);

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/emails',  emailRoutes);
app.use('/api/inbox',   inboxRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/v1',      apiRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Static files (frontend) ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..'), { index: 'index.html' }));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  // SPA fallback
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500)
    .set('Content-Type', 'application/json')
    .end(JSON.stringify({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    }));
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀  TempMail Pro backend running on http://localhost:${PORT}`);
    console.log(`📬  API:    http://localhost:${PORT}/api/v1/info`);
    console.log(`🛡  Admin:  http://localhost:${PORT}/admin`);
    console.log(`❤  Health: http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = app;
