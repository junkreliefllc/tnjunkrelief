// netlify/functions/unavailability.js
// Stores owner-blocked dates (e.g., vacation days) that should appear
// unavailable to customers on the booking calendar.
//
// GET     → public, returns array of blocked dateKeys (YYYY-MM-DD)
// POST    → admin-only, adds a blocked date  { password, dateKey, note? }
// DELETE  → admin-only, removes a blocked date { password, dateKey }

const { getStore } = require('@netlify/blobs');

const STORE_KEY = 'unavailable-days';

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let store;
  try {
    store = getStore({
      name: 'bookings',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Blob init failed: ' + e.message }) };
  }

  // ── GET — public, returns the list of blocked days ──
  if (event.httpMethod === 'GET') {
    try {
      const raw = await store.get(STORE_KEY);
      const days = raw ? JSON.parse(raw) : [];
      // Auto-prune anything older than 60 days to keep storage tidy
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 60);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const fresh = days.filter(d => d.dateKey >= cutoffStr);
      return { statusCode: 200, headers, body: JSON.stringify(fresh) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST — admin only, add a blocked day ──
  if (event.httpMethod === 'POST') {
    try {
      const { password, dateKey, note } = JSON.parse(event.body);
      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid dateKey (expected YYYY-MM-DD)' }) };
      }

      const raw = await store.get(STORE_KEY);
      let days = raw ? JSON.parse(raw) : [];

      // Prevent duplicates — if the date already exists, just update the note
      const existingIdx = days.findIndex(d => d.dateKey === dateKey);
      if (existingIdx >= 0) {
        days[existingIdx].note = note || '';
        days[existingIdx].updatedAt = new Date().toISOString();
      } else {
        days.push({
          dateKey,
          note: note || '',
          createdAt: new Date().toISOString()
        });
      }

      await store.set(STORE_KEY, JSON.stringify(days));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, days }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── DELETE — admin only, remove a blocked day ──
  if (event.httpMethod === 'DELETE') {
    try {
      const { password, dateKey } = JSON.parse(event.body);
      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      if (!dateKey) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing dateKey' }) };
      }

      const raw = await store.get(STORE_KEY);
      let days = raw ? JSON.parse(raw) : [];
      const before = days.length;
      days = days.filter(d => d.dateKey !== dateKey);

      await store.set(STORE_KEY, JSON.stringify(days));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, removed: before - days.length, days }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
