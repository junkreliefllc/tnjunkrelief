// netlify/functions/admin-create-booking.js
// Allows the owner to manually create a booking from the admin page.
// Options:
//   - Block calendar slot (always)
//   - Send Stripe payment link to customer (optional)
//   - Send customer confirmation email (optional)
//   - Override blocked days / overlapping slots (optional)

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
    const {
      password,
      customerName,
      phone,
      email,
      address,
      dateKey,
      startHr,
      endHr,
      total,
      deposit,
      service,
      notes,
      paymentMode,    // 'none' | 'link'
      sendEmail       // boolean — email customer confirmation
    } = JSON.parse(event.body);

    // ── Verify admin password ──
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // ── Validate ──
    if (!customerName || !dateKey || startHr === undefined || endHr === undefined) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    let paymentLink = null;
    let stripeId = '';

    // ── Generate Stripe payment link if requested ──
    if (paymentMode === 'link' && deposit && deposit > 0) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        const product = await stripe.products.create({
          name: `Junk Relief LLC — Deposit for ${customerName} on ${dateKey}`,
          description: service || 'Junk removal service deposit'
        });

        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(deposit * 100),
          currency: 'usd'
        });

        const link = await stripe.paymentLinks.create({
          line_items: [{ price: price.id, quantity: 1 }],
          metadata: {
            customer_name: customerName,
            phone: phone || '',
            email: email || '',
            dateKey,
            startHr: String(startHr),
            manual_booking: 'true'
          }
        });

        paymentLink = link.url;
        stripeId = link.id;
      } catch(stripeErr) {
        console.error('Stripe payment link error:', stripeErr.message);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Could not create payment link: ' + stripeErr.message })
        };
      }
    }

    // ── Save booked slot ──
    try {
      const store = getStore({
        name: 'bookings',
        consistency: 'strong',
        siteID: process.env.BLOBS_SITE_ID,
        token: process.env.BLOBS_TOKEN
      });

      const raw = await store.get('all-bookings');
      let bookings = raw ? JSON.parse(raw) : {};

      if (!bookings[dateKey]) bookings[dateKey] = [];
      bookings[dateKey].push({
        startHr,
        endHr,
        customerName,
        phone: phone || '',
        email: email || '',
        address: address || '',
        service: service || '',
        notes: notes || '',
        total: total || 0,
        deposit: deposit || 0,
        stripeId: stripeId,
        paymentLink: paymentLink || '',
        paymentStatus: paymentMode === 'link' ? 'awaiting' : 'cash_on_site',
        manualBooking: true,
        bookedAt: new Date().toISOString()
      });

      await store.set('all-bookings', JSON.stringify(bookings));
    } catch(blobErr) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Could not save booking: ' + blobErr.message })
      };
    }

    // ── Send customer email if requested ──
    let emailSent = false;
    if (sendEmail && email) {
      try {
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

        if (RESEND_API_KEY) {
          const dateObj = new Date(dateKey + 'T12:00:00');
          const dateFmt = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
          const startFmt = fmtHr(startHr);
          const endFmt = fmtHr(endHr);

          const paymentSection = paymentLink
            ? `<tr><td style="padding:24px 32px 0">
                 <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Pay Your Deposit</p>
                 <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
                   <tr><td style="padding:16px;text-align:center">
                     <p style="margin:0 0 14px;color:#aaa;font-size:14px;line-height:1.5">Please pay your <strong style="color:#fff">$${deposit}</strong> deposit to confirm this booking:</p>
                     <a href="${paymentLink}" style="display:inline-block;background:#E31212;color:#fff;padding:14px 28px;font-weight:800;font-size:14px;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase">Pay Deposit Now →</a>
                   </td></tr>
                 </table>
               </td></tr>`
            : `<tr><td style="padding:16px 32px 0">
                 <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border-left:3px solid #4caf50;padding:14px 16px">
                   <tr><td style="color:#4caf50;font-weight:700;font-size:13px">💵 Payment due on job day — cash, card, Venmo, or CashApp accepted on-site.</td></tr>
                 </table>
               </td></tr>`;

          const customerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
    <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
  </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#4caf50;padding:36px 32px;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">✅</div>
    <h1 style="margin:0;font-size:30px;font-weight:900;letter-spacing:2px;color:#fff;text-transform:uppercase">Appointment Scheduled</h1>
    <p style="margin:10px 0 0;color:rgba(255,255,255,0.75);font-size:15px">Here are the details we discussed.</p>
  </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td style="padding:28px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Your Appointment</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Date</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${dateFmt}</span>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Time Window</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${startFmt} – ${endFmt}</span>
        </td></tr>
        ${address ? `<tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Address</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${address}</span>
        </td></tr>` : ''}
        ${total ? `<tr><td style="padding:12px 16px">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Estimated Total</span><br>
          <span style="color:#E31212;font-family:'Arial',sans-serif;font-weight:900;font-size:22px">$${total}</span>
        </td></tr>` : ''}
      </table>
    </td></tr>
    ${service ? `<tr><td style="padding:16px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Service</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border-left:3px solid #333;padding:14px 16px">
        <tr><td style="color:#ccc;font-size:14px;line-height:1.6">${service}</td></tr>
      </table>
    </td></tr>` : ''}
    ${paymentSection}
    <tr><td style="padding:24px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Questions?</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <tr><td style="padding:16px">
          <a href="tel:9315610431" style="display:inline-block;margin:4px 8px 4px 0;background:#E31212;color:#fff;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase">📞 (931) 561-0431</a>
          <a href="sms:9315610431" style="display:inline-block;margin:4px 0;background:#2a2a2a;color:#f5f5f0;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border:1px solid #333">💬 Text Us</a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:32px;text-align:center;color:#444;font-size:12px;line-height:1.8">
      <strong style="color:#666">Junk Relief LLC</strong> · Clarksville, TN<br>
      <span style="color:#333">© ${new Date().getFullYear()} Junk Relief LLC. All rights reserved.</span>
    </td></tr>
  </table>
</body></html>`;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: `Junk Relief LLC <${FROM_EMAIL}>`,
              to: [email],
              subject: `✅ Junk Relief Appointment — ${dateFmt}`,
              html: customerHtml
            })
          });

          if (res.ok) emailSent = true;
        }
      } catch(emailErr) {
        console.warn('Email send failed (non-fatal):', emailErr.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentLink,
        emailSent,
        message: paymentLink
          ? 'Booking created. Payment link generated — share it with the customer.'
          : 'Booking created. Customer pays cash on-site.'
      })
    };

  } catch(err) {
    console.error('admin-create-booking error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};

function fmtHr(hr) {
  const suffix = hr >= 12 ? 'PM' : 'AM';
  const h = hr > 12 ? hr - 12 : hr === 0 ? 12 : hr;
  return `${h}:00 ${suffix}`;
}
