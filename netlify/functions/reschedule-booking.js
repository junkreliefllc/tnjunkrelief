// netlify/functions/reschedule-booking.js
// Moves an existing booking to a new date/time. Used by BOTH:
//   - Admin (authenticates with password, no time cutoff)
//   - Customer (authenticates with the cancel-style token, 24-hour cutoff)
//
// Moving the booking automatically frees the old slot and blocks the new one,
// because the calendar reads availability from where bookings live in storage.
// Same bookingId and all customer data are preserved.

const { getStore } = require('@netlify/blobs');

// Slot overlap test — mirrors the customer booking flow's isSlotBlocked logic.
function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

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
    const {
      // identity of the booking being moved
      oldDateKey, bookingId, stripeId,
      // where it's going
      newDateKey, newStartHr,
      // auth — one of these
      password, token,
      // who's doing it (for notifications / logging)
      via // 'admin' | 'customer'
    } = JSON.parse(event.body);

    if (!oldDateKey || !newDateKey || newStartHr === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    const store = getStore({
      name: 'bookings',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const raw = await store.get('all-bookings');
    let bookings = raw ? JSON.parse(raw) : {};

    // ── Locate the booking on its old date ──
    const oldDay = bookings[oldDateKey] || [];
    let idx = -1;
    if (bookingId) {
      idx = oldDay.findIndex(b => b.bookingId === bookingId);
    }
    // Fallback for older bookings that may lack a bookingId: match by stripeId
    if (idx === -1 && stripeId) {
      idx = oldDay.findIndex(b => b.stripeId && b.stripeId === stripeId);
    }
    if (idx === -1) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found.' }) };
    }
    const booking = oldDay[idx];

    // ── Authenticate ──
    if (via === 'admin') {
      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }
    } else {
      // Customer path — token must match base64(oldDateKey:stripeId), same scheme as cancel.js
      const expectedToken = Buffer.from(`${oldDateKey}:${booking.stripeId}`).toString('base64');
      if (!token || token !== expectedToken) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid reschedule link.' }) };
      }
      // 24-hour cutoff (customer only) — can't self-reschedule within 24h of the CURRENT appointment.
      const apptDate = new Date(`${oldDateKey}T${String(booking.startHr).padStart(2,'0')}:00:00`);
      const hoursUntil = (apptDate - new Date()) / (1000 * 60 * 60);
      if (hoursUntil < 24) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Reschedules must be made at least 24 hours before your appointment. Please call (931) 561-0431.' }) };
      }
    }

    // ── Validate the new slot ──
    const duration = (booking.endHr - booking.startHr) || 2;
    const newEndHr = newStartHr + duration;
    if (newEndHr > 18) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'That start time runs past 6:00 PM. Please pick an earlier time.' }) };
    }
    // Day-of-week guard: allowed Tue(2) Wed(3) Thu(4) Fri(5)
    const dow = new Date(`${newDateKey}T12:00:00`).getDay();
    if (![2,3,4,5].includes(dow)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'We only schedule Tuesday through Friday. Please pick another day.' }) };
    }

    // ── Check the new slot isn't already taken (excluding this same booking) ──
    const targetDay = bookings[newDateKey] || [];
    for (const b of targetDay) {
      if (b.bookingId === booking.bookingId) continue; // ignore self
      if (overlaps(newStartHr, newEndHr, b.startHr, b.endHr)) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'That time slot is no longer available. Please choose another.' }) };
      }
    }

    // ── Perform the move ──
    const oldStartHr = booking.startHr;
    const oldStartLabel = oldDateKey;
    // remove from old day
    oldDay.splice(idx, 1);
    if (oldDay.length === 0) delete bookings[oldDateKey];
    else bookings[oldDateKey] = oldDay;

    // update times and append to new day
    booking.startHr = newStartHr;
    booking.endHr = newEndHr;
    booking.rescheduledAt = new Date().toISOString();
    booking.rescheduledVia = via === 'admin' ? 'admin' : 'customer';
    if (!bookings[newDateKey]) bookings[newDateKey] = [];
    bookings[newDateKey].push(booking);

    await store.set('all-bookings', JSON.stringify(bookings));

    // ── Notifications (best-effort; never fail the move over an email) ──
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const OWNER_EMAIL = process.env.OWNER_EMAIL || 'junkreliefllc@gmail.com';
    const FROM_EMAIL  = process.env.FROM_EMAIL  || 'onboarding@resend.dev';

    function fmtDate(dk) {
      try { return new Date(`${dk}T12:00:00`).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }); }
      catch(e) { return dk; }
    }
    function fmtTime(hr) {
      const suffix = hr >= 12 ? 'PM' : 'AM';
      const h = hr > 12 ? hr-12 : hr === 0 ? 12 : hr;
      return `${h}:00 ${suffix}`;
    }

    const oldWhen = `${fmtDate(oldStartLabel)} at ${fmtTime(oldStartHr)}`;
    const newWhen = `${fmtDate(newDateKey)} at ${fmtTime(newStartHr)}`;

    if (RESEND_API_KEY) {
      const custHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
      <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
    </td></tr>
    <tr><td style="background:#1a1a1a;padding:32px">
      <h2 style="font-size:24px;font-weight:900;color:#f5f5f0;margin:0 0 16px">Appointment Rescheduled ✅</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.7;margin:0 0 16px">Hi ${booking.customerName || 'there'}, your appointment has been moved.</p>
      <p style="color:#888;font-size:14px;margin:0 0 6px;text-decoration:line-through">${oldWhen}</p>
      <p style="color:#f5f5f0;font-size:16px;font-weight:700;margin:0 0 24px">${newWhen}</p>
      <p style="color:#aaa;font-size:14px;line-height:1.7">Need to make another change? Call us at <a href="tel:9315610431" style="color:#E31212;font-weight:700">(931) 561-0431</a>.</p>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;color:#444;font-size:12px">Junk Relief LLC · Clarksville, TN · (931) 561-0431</td></tr>
  </table>
</body></html>`;

      const ownerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#E31212;padding:20px 24px">
      <h1 style="margin:0;font-size:20px;font-weight:900;color:#fff">📅 Booking Rescheduled</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px">${booking.customerName || 'A customer'} — moved ${via === 'admin' ? 'by you (admin)' : 'by the customer'}</p>
    </td></tr>
    <tr><td style="background:#1a1a1a;padding:20px 24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${[
          ['Customer', booking.customerName || '—'],
          ['Phone', booking.phone || '—'],
          ['Was', oldWhen],
          ['Now', newWhen],
          ['Service', booking.service || '—']
        ].map(([l,v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #222"><span style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1px">${l}</span><br><span style="color:#f5f5f0;font-weight:600;font-size:14px">${v}</span></td></tr>`).join('')}
      </table>
      <p style="margin:16px 0 0;color:#555;font-size:12px">The old slot is now free and the new slot is blocked on your calendar automatically.</p>
    </td></tr>
  </table>
</body></html>`;

      async function sendEmail(to, subject, html) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({ from: `Junk Relief LLC <${FROM_EMAIL}>`, to: [to], subject, html })
          });
        } catch(e) { console.error('reschedule email failed (non-fatal):', e.message); }
      }

      const jobs = [ sendEmail(OWNER_EMAIL, `📅 Rescheduled: ${booking.customerName || 'Customer'} → ${newWhen}`, ownerHtml) ];
      if (booking.email) jobs.push(sendEmail(booking.email, 'Your Junk Relief Appointment Has Been Rescheduled', custHtml));
      await Promise.all(jobs);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        bookingId: booking.bookingId,
        newDateKey,
        newStartHr,
        newEndHr,
        message: `Rescheduled to ${newWhen}.`
      })
    };

  } catch(err) {
    console.error('reschedule-booking.js error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
