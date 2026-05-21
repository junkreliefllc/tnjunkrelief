const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const store = getStore('bookings');

  // GET — return all booked slots
  if (event.httpMethod === 'GET') {
    try {
      let bookings = {};
      try {
        const raw = await store.get('all-bookings');
        if (raw) bookings = JSON.parse(raw);
      } catch(e) {
        bookings = {};
      }
      return { statusCode: 200, headers, body: JSON.stringify(bookings) };
    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // POST — save a new booked slot
  if (event.httpMethod === 'POST') {
    try {
      const { dateKey, startHr, endHr, customerName, phone, email, service } = JSON.parse(event.body);

      if (!dateKey || startHr === undefined || endHr === undefined) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
      }

      // Load existing bookings
      let bookings = {};
      try {
        const raw = await store.get('all-bookings');
        if (raw) bookings = JSON.parse(raw);
      } catch(e) {
        bookings = {};
      }

      // Add new slot
      if (!bookings[dateKey]) bookings[dateKey] = [];
      bookings[dateKey].push({
        startHr,
        endHr,
        customerName: customerName || '',
        phone: phone || '',
        email: email || '',
        service: service || '',
        bookedAt: new Date().toISOString()
      });

      await store.set('all-bookings', JSON.stringify(bookings));

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch(err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: 'Method Not Allowed' };
};
