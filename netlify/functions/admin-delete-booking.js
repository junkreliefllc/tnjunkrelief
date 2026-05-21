// netlify/functions/admin-delete-booking.js
// Allows the owner to manually remove a booking from the admin page.
// Optionally refunds the deposit via Stripe.
// Requires server-side admin password verification.

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
    const { password, dateKey, startHr, stripeId, refund } = JSON.parse(event.body);

    // ── Verify admin password ──
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    if (!password || password !== ADMIN_PASSWORD) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (!dateKey || startHr === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    let refundId = null;
    let refundAmount = null;

    // ── Process Stripe refund if requested ──
    if (refund && stripeId) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.retrieve(stripeId);
        const chargeId = paymentIntent.latest_charge;

        if (chargeId) {
          const refundObj = await stripe.refunds.create({ charge: chargeId });
          refundId = refundObj.id;
          refundAmount = (refundObj.amount / 100).toFixed(2);
        }
      } catch(stripeErr) {
        console.error('Stripe refund error:', stripeErr.message);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Refund failed: ' + stripeErr.message })
        };
      }
    }

    // ── Remove the booked slot from Netlify Blobs ──
    try {
      const store = getStore({
        name: 'bookings',
        consistency: 'strong',
        siteID: process.env.BLOBS_SITE_ID,
        token: process.env.BLOBS_TOKEN
      });
      const raw = await store.get('all-bookings');
      let bookings = raw ? JSON.parse(raw) : {};

      if (bookings[dateKey]) {
        bookings[dateKey] = bookings[dateKey].filter(b => b.startHr !== startHr);
        if (bookings[dateKey].length === 0) delete bookings[dateKey];
        await store.set('all-bookings', JSON.stringify(bookings));
      }
    } catch(blobErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Could not remove from calendar: ' + blobErr.message })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refunded: !!refundId,
        refundAmount,
        refundId
      })
    };

  } catch(err) {
    console.error('admin-delete-booking error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
