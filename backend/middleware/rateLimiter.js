'use strict';

const rateLimit = require('express-rate-limit');

const WINDOW  = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const MAX     = parseInt(process.env.RATE_LIMIT_MAX       || '100',    10);

/** Always send a JSON rate-limit response regardless of express-rate-limit version */
function createJsonRateLimitHandler(options) {
  return (_req, res) => {
    res.status(options.statusCode || 429)
      .set('Content-Type', 'application/json')
      .end(JSON.stringify({ error: options.message && options.message.error
        ? options.message.error
        : 'Too many requests, please try again later.' }));
  };
}

/** General API rate limiter */
const general = rateLimit({
  windowMs: WINDOW,
  max:      MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later.' },
  handler: createJsonRateLimitHandler({ statusCode: 429, message: { error: 'Too many requests, please try again later.' } }),
});

/** Stricter limiter for auth endpoints */
const auth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:  { error: 'Too many auth attempts, please wait 15 minutes.' },
  handler: createJsonRateLimitHandler({ statusCode: 429, message: { error: 'Too many auth attempts, please wait 15 minutes.' } }),
});

/** Email generation limiter */
const emailGen = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:  { error: 'Too many email generation requests. Please wait.' },
  handler: createJsonRateLimitHandler({ statusCode: 429, message: { error: 'Too many email generation requests. Please wait.' } }),
});

module.exports = { general, auth, emailGen };
