// netlify/functions/admin-adjust-booking.js
// Allows the owner to add items / increase the total on an existing booking.
// Generates a Stripe payment link for the additional amount.
// Optionally emails the customer.

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
      dateKey,
      startHr,             // identifies which booking
      additionalItems,     // string describing what's being added
      additionalAmount,    // dollars
      sendEmail            // boolean
    } = JSON.parse(event.body);

    // ── Verify admin password ──
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    if (!dateKey || startHr === undefined || !additionalAmount || additionalAmount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields or invalid amount.' }) };
    }

    // ── Load booking ──
    const store = getStore({
      name: 'bookings',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const raw = await store.get('all-bookings');
    let bookings = raw ? JSON.parse(raw) : {};
    const slots = bookings[dateKey] || [];
    const slot = slots.find(b => b.startHr === startHr);

    if (!slot) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Booking not found' }) };
    }

    // ── Create Stripe payment link for the additional amount ──
    let paymentLink = null;
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

      const product = await stripe.products.create({
        name: `Junk Relief LLC — Additional Items for ${slot.customerName || 'Customer'} on ${dateKey}`,
        description: additionalItems || 'Additional items added on-site'
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(additionalAmount * 100),
        currency: 'usd'
      });

      const link = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: {
          original_booking: `${dateKey}-${startHr}`,
          customer_name: slot.customerName || '',
          adjustment: 'true'
        }
      });

      paymentLink = link.url;
    } catch(stripeErr) {
      console.error('Stripe payment link error:', stripeErr.message);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Could not create payment link: ' + stripeErr.message })
      };
    }

    // ── Update the booking record ──
    if (!slot.adjustments) slot.adjustments = [];
    slot.adjustments.push({
      addedAt: new Date().toISOString(),
      items: additionalItems || '',
      amount: additionalAmount,
      paymentLink,
      status: 'awaiting'
    });
    slot.total = (slot.total || 0) + additionalAmount;

    await store.set('all-bookings', JSON.stringify(bookings));

    // ── Optionally send email to customer ──
    let emailSent = false;
    if (sendEmail && slot.email) {
      try {
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

        if (RESEND_API_KEY) {
          const dateObj = new Date(dateKey + 'T12:00:00');
          const dateFmt = dateObj.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

          const customerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
    <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
  </td></tr></table>
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td style="background:#1a1a1a;border-top:3px solid #E31212;padding:32px">
      <h2 style="margin:0 0 16px;font-family:Arial;font-size:24px;font-weight:900;color:#f5f5f0">Job Update</h2>
      <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 12px">
        Hi ${slot.customerName || 'there'}, we added a few extra items to your job on <strong style="color:#fff">${dateFmt}</strong>.
      </p>
      ${additionalItems ? `<p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 12px"><strong style="color:#fff">Items added:</strong> ${additionalItems}</p>` : ''}
      <p style="color:#aaa;font-size:14px;line-height:1.6;margin:0 0 20px">
        <strong style="color:#fff">Additional amount due:</strong> <span style="color:#E31212;font-weight:900;font-size:18px">$${additionalAmount}</span>
      </p>
      <a href="${paymentLink}" style="display:inline-block;background:#E31212;color:#fff;padding:14px 28px;font-weight:800;font-size:14px;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase">Pay $${additionalAmount} Now →</a>
      <p style="color:#666;font-size:12px;margin:20px 0 0;line-height:1.6">
        Questions? Call us at <a href="tel:9315610431" style="color:#E31212;text-decoration:none">(931) 561-0431</a>.
      </p>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;color:#444;font-size:12px;line-height:1.8">
      Junk Relief LLC · Clarksville, TN
    </td></tr>
  </table>
</body></html>`;

          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: `Junk Relief LLC <${FROM_EMAIL}>`,
              to: [slot.email],
              subject: `Additional charge for your Junk Relief job — $${additionalAmount}`,
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
        newTotal: slot.total
      })
    };

  } catch(err) {
    console.error('admin-adjust-booking error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
