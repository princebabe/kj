'use strict';

const rateLimit = require('express-rate-limit');

const WINDOW  = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const MAX     = parseInt(process.env.RATE_LIMIT_MAX       || '100',    10);

/** General API rate limiter */
const general = rateLimit({
  windowMs: WINDOW,
  max:      MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Stricter limiter for auth endpoints */
const auth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  message:  { error: 'Too many auth attempts, please wait 15 minutes.' },
});

/** Email generation limiter */
const emailGen = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max:      10,
  message:  { error: 'Too many email generation requests. Please wait.' },
});

module.exports = { general, auth, emailGen };
