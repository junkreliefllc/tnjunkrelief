// netlify/functions/photo-utils.js
// Shared helper for generating and checking signed photo links.
// Not a standalone endpoint — required by other functions.
//
// Set PHOTO_SIGNING_SECRET in Netlify env vars (any long random string).
// This is what makes a link "tamper-proof": only the server knows this
// secret, so nobody can edit a link's expiry or photo key and have it
// still pass the check.

const crypto = require('crypto');

const LINK_LIFETIME_SECONDS = 10 * 60; // 10 minutes

function sign(key, expires) {
  const secret = process.env.PHOTO_SIGNING_SECRET;
  if (!secret) throw new Error('PHOTO_SIGNING_SECRET is not set in Netlify env vars');
  return crypto
    .createHmac('sha256', secret)
    .update(`${key}:${expires}`)
    .digest('hex');
}

// Builds a full signed URL for a given photo key, valid for ~10 minutes.
function buildSignedUrl(key, baseUrl) {
  const expires = Math.floor(Date.now() / 1000) + LINK_LIFETIME_SECONDS;
  const sig = sign(key, expires);
  const params = new URLSearchParams({ key, expires: String(expires), sig });
  return `${baseUrl}/.netlify/functions/view-photo?${params.toString()}`;
}

// Checks a key/expires/sig triple. Returns { valid: true } or { valid: false, reason }.
function verify(key, expires, sig) {
  if (!key || !expires || !sig) return { valid: false, reason: 'Missing parameters' };

  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum)) return { valid: false, reason: 'Bad expiry' };

  if (Math.floor(Date.now() / 1000) > expiresNum) {
    return { valid: false, reason: 'Link expired' };
  }

  const expected = sign(key, expiresNum);

  // Use timing-safe comparison so the check itself can't leak info about
  // the correct signature via response-time differences.
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

module.exports = { buildSignedUrl, verify, LINK_LIFETIME_SECONDS };
