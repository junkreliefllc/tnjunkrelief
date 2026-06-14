// netlify/functions/complete-booking.js
// Marks a booking as completed. Admin password required.
// Toggles: if already completed, unmarks it (in case of accidental click).

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { password, dateKey, bookingId, startHr, action } = JSON.parse(event.body);

    // Auth
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    if (!dateKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing dateKey' }) };
    }

    const store = getStore({
      name: 'bookings',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const raw = await store.get('all-bookings');
    if (!raw) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No bookings found' }) };
    }
    const bookings = JSON.parse(raw);
    const day = bookings[dateKey];
    if (!day) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'No bookings on that date' }) };
    }

    // Find by bookingId if provided, else by startHr (for old bookings without bookingId)
    let booking;
    if (bookingId) {
      booking = day.find(b => b.bookingId === bookingId);
    }
    if (!booking && startHr !== undefined) {
      booking = day.find(b => b.startHr === startHr);
    }
    if (!booking) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
    }

    if (action === 'unmark') {
      delete booking.jobStatus;
      delete booking.completedAt;
    } else {
      booking.jobStatus = 'completed';
      booking.completedAt = new Date().toISOString();
    }

    await store.set('all-bookings', JSON.stringify(bookings));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, jobStatus: booking.jobStatus || null })
    };
  } catch (err) {
    console.error('complete-booking error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
