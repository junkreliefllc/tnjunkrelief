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
    const { password, dateKey, bookingId, startHr, action, sendEmail, hasCompletionPhotos } = JSON.parse(event.body);

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
      if (hasCompletionPhotos) booking.completionPhotoAt = booking.completedAt;
    }

    await store.set('all-bookings', JSON.stringify(bookings));

    // ── Optional "job complete" email to the customer (best-effort, never fatal) ──
    let emailSent = false;
    if (action !== 'unmark' && sendEmail && booking.email) {
      const RESEND_API_KEY = process.env.RESEND_API_KEY;
      const OWNER_EMAIL = process.env.OWNER_EMAIL || 'junkreliefllc@gmail.com';
      const FROM_EMAIL  = process.env.FROM_EMAIL  || 'onboarding@resend.dev';
      if (RESEND_API_KEY) {
        try {
          const custName = booking.customerName || 'there';
          const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
    </td></tr>
    <tr><td style="background:#1a1a1a;padding:32px">
      <h2 style="font-size:24px;font-weight:900;color:#f5f5f0;margin:0 0 16px">Job Complete ✅</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 16px">
        Hi ${custName}, your junk removal job is finished. Thank you for choosing Junk Relief LLC — we appreciate your business!
      </p>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 16px">
        If everything looks good, we'd be grateful for a quick review. If anything isn't right, just reply to this email or call us and we'll make it right.
      </p>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0">
        Questions? Call <a href="tel:9315610431" style="color:#E31212;font-weight:700">(931) 561-0431</a>.
      </p>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;color:#444;font-size:12px">
      Junk Relief LLC · Clarksville, TN · (931) 561-0431
    </td></tr>
  </table>
</body></html>`;
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ from: `Junk Relief LLC <${FROM_EMAIL}>`, to: [booking.email], subject: 'Your Junk Relief Job Is Complete — Thank You!', html })
          });
          emailSent = true;
        } catch (e) {
          console.warn('completion email failed (non-fatal):', e.message);
        }
      } else {
        console.warn('RESEND_API_KEY missing — completion saved, email skipped.');
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, jobStatus: booking.jobStatus || null, emailSent })
    };
  } catch (err) {
    console.error('complete-booking error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
