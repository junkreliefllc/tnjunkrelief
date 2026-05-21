// netlify/functions/cancel.js
// Handles booking cancellation:
//   - Verifies the cancellation token
//   - Auto-refunds the deposit via Stripe if >= 24 hours before appointment
//   - Removes the booked slot from Netlify Blobs
//   - Sends cancellation confirmation emails to customer and owner

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
    const { token, dateKey, startHr, stripeId, customerName, email, phone, date, time } = JSON.parse(event.body);

    if (!token || !dateKey || !stripeId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    // ── Verify cancellation token ──
    // Token = simple HMAC-style check: base64(dateKey + stripeId)
    const expectedToken = Buffer.from(`${dateKey}:${stripeId}`).toString('base64');
    if (token !== expectedToken) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid cancellation token.' }) };
    }

    // ── Check if >= 24 hours before appointment ──
    const appointmentDate = new Date(`${dateKey}T${String(startHr).padStart(2,'0')}:00:00`);
    const now = new Date();
    const hoursUntil = (appointmentDate - now) / (1000 * 60 * 60);
    const eligibleForRefund = hoursUntil >= 24;

    let refundId = null;
    let refundAmount = null;

    // ── Process Stripe refund if eligible ──
    if (eligibleForRefund && stripeId) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.retrieve(stripeId);
        const chargeId = paymentIntent.latest_charge;

        if (chargeId) {
          const refund = await stripe.refunds.create({ charge: chargeId });
          refundId = refund.id;
          refundAmount = (refund.amount / 100).toFixed(2);
        }
      } catch(stripeErr) {
        console.error('Stripe refund error:', stripeErr.message);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Could not process refund: ' + stripeErr.message })
        };
      }
    }

    // ── Remove the booked slot from Netlify Blobs ──
    try {
      const store = getStore({ name: 'bookings', consistency: 'strong' });
      const raw = await store.get('all-bookings');
      let bookings = raw ? JSON.parse(raw) : {};

      if (bookings[dateKey]) {
        bookings[dateKey] = bookings[dateKey].filter(b => b.startHr !== startHr);
        if (bookings[dateKey].length === 0) delete bookings[dateKey];
        await store.set('all-bookings', JSON.stringify(bookings));
      }
    } catch(blobErr) {
      console.warn('Could not remove booked slot:', blobErr.message);
    }

    // ── Send cancellation emails ──
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const OWNER_EMAIL    = process.env.OWNER_EMAIL || 'junkreliefllc@gmail.com';
    const FROM_EMAIL     = process.env.FROM_EMAIL  || 'onboarding@resend.dev';

    if (RESEND_API_KEY && email) {
      const refundMsg = eligibleForRefund
        ? `Your deposit of <strong>$${refundAmount}</strong> will be refunded to your original payment method within 5–10 business days.`
        : `<strong>No refund will be issued</strong> as the cancellation was made less than 24 hours before your appointment.`;

      const customerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
    </td></tr>
    <tr><td style="background:#1a1a1a;border-top:3px solid #555;padding:32px">
      <h2 style="font-size:24px;font-weight:900;color:#f5f5f0;margin:0 0 16px">Booking Cancelled</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 16px">
        Hi ${customerName}, your appointment on <strong style="color:#f5f5f0">${date}</strong> at <strong style="color:#f5f5f0">${time}</strong> has been cancelled.
      </p>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 24px">${refundMsg}</p>
      <p style="color:#aaa;font-size:14px;line-height:1.7">
        Need to reschedule? Give us a call at <a href="tel:9315610431" style="color:#E31212;font-weight:700">(931) 561-0431</a> and we'll get you back on the schedule.
      </p>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;color:#444;font-size:12px">
      Junk Relief LLC · Clarksville, TN · (931) 561-0431
    </td></tr>
  </table>
</body></html>`;

      const ownerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#E31212;padding:20px 24px">
      <h1 style="margin:0;font-size:20px;font-weight:900;color:#fff">⚠️ Booking Cancelled</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${customerName} cancelled their appointment.</p>
    </td></tr>
    <tr><td style="background:#1a1a1a;padding:20px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${[
          ['Customer', customerName || '—'],
          ['Phone', phone || '—'],
          ['Email', email || '—'],
          ['Date', date || dateKey],
          ['Time', time || '—'],
          ['Stripe ID', stripeId],
          ['Refund Issued', eligibleForRefund ? `Yes — $${refundAmount} (${refundId})` : 'No — cancelled < 24hrs before appointment']
        ].map(([label, val]) => `
          <tr><td style="padding:8px 0;border-bottom:1px solid #222">
            <span style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px">${label}</span><br>
            <span style="color:#f5f5f0;font-weight:600;font-size:14px">${val}</span>
          </td></tr>`).join('')}
      </table>
      <p style="margin:16px 0 0;color:#555;font-size:12px">The time slot has been freed up on the calendar automatically.</p>
    </td></tr>
  </table>
</body></html>`;

      async function sendEmail(to, subject, html) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({ from: `Junk Relief LLC <${FROM_EMAIL}>`, to: [to], subject, html })
        });
        return res.json();
      }

      await Promise.all([
        sendEmail(email, 'Your Junk Relief Booking Has Been Cancelled', customerHtml),
        sendEmail(OWNER_EMAIL, `⚠️ Cancelled: ${customerName} — ${date}`, ownerHtml)
      ]);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refunded: eligibleForRefund,
        refundAmount: refundAmount,
        refundId: refundId,
        message: eligibleForRefund
          ? `Booking cancelled. Your $${refundAmount} deposit will be refunded within 5–10 business days.`
          : 'Booking cancelled. No refund issued (cancellation was less than 24 hours before appointment).'
      })
    };

  } catch(err) {
    console.error('cancel.js error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
