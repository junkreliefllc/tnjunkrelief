// netlify/functions/leads.js
// Admin-only management of contact form leads.
// GET: returns current leads, auto-removing any older than 14 days that
//   were never converted or dismissed. No password required on GET,
//   matching the same pattern as bookings.js.
// POST action=dismiss: removes a lead manually. Requires admin password.
// POST action=convert: marks a lead converted and removes it from the
//   active list (the actual booking is created separately via the
//   existing admin-create-booking.js, pre-filled from this lead's data).
//   Requires admin password.

const { getStore } = require('@netlify/blobs');

const EXPIRY_DAYS = 14;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let store;
  try {
    store = getStore({
      name: 'leads',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });
  } catch (initErr) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Blob store init failed: ' + initErr.message }) };
  }

  async function loadLeads() {
    try {
      const raw = await store.get('all-leads');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function isExpired(lead) {
    const ageMs = Date.now() - new Date(lead.createdAt).getTime();
    return ageMs > EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  }

  // ── GET: list active leads, pruning expired ones ──
  if (event.httpMethod === 'GET') {
    try {
      let leads = await loadLeads();
      const before = leads.length;
      leads = leads.filter(l => l.status === 'new' && !isExpired(l));

      if (leads.length !== before) {
        await store.set('all-leads', JSON.stringify(leads));
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, leads }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── POST: dismiss or convert ──
  if (event.httpMethod === 'POST') {
    try {
      const { password, leadId, action } = JSON.parse(event.body);

      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
      if (!leadId || !action) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing leadId or action' }) };
      }
      if (action !== 'dismiss' && action !== 'convert') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'action must be dismiss or convert' }) };
      }

      let leads = await loadLeads();
      const lead = leads.find(l => l.leadId === leadId);
      if (!lead) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Lead not found' }) };
      }

      // Both actions remove the lead from the active New Leads list —
      // dismiss because the owner chose to clear it, convert because it
      // became a real booking and doesn't need to live in both places.
      leads = leads.filter(l => l.leadId !== leadId);
      await store.set('all-leads', JSON.stringify(leads));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
