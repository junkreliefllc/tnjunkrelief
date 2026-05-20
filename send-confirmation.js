// netlify/functions/send-confirmation.js
// Sends two emails via Resend after a successful payment:
//   1. Customer receipt & confirmation
//   2. Owner job sheet
//
// Required env vars in Netlify dashboard:
//   RESEND_API_KEY   — from resend.com (free, 3k emails/month)
//   OWNER_EMAIL      — your email, e.g. junkreliefllc@gmail.com
//   FROM_EMAIL       — a verified sender, e.g. bookings@yourdomain.com
//                      (or onboarding@resend.dev for testing before domain is set up)

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
      customerName,
      email,
      phone,
      address,
      date,
      time,
      duration,
      total,
      deposit,
      balance,
      stripeId,
      notes,
      items,        // array: [{name, qty, unit, sub}]
      pricingStr    // fallback plain-text summary
    } = JSON.parse(event.body);

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const OWNER_EMAIL    = process.env.OWNER_EMAIL || 'junkreliefllc@gmail.com';
    const FROM_EMAIL     = process.env.FROM_EMAIL  || 'onboarding@resend.dev';

    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set in environment variables.');
    if (!email)          throw new Error('Customer email is required.');

    // ── Build item rows for HTML emails ──
    const itemRows = Array.isArray(items) && items.length
      ? items.map(it => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #222;color:#f5f5f0;font-weight:600">${it.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #222;color:#aaa;text-align:center">${it.qty || 1}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #222;color:#E31212;font-weight:700;text-align:right">$${it.sub || it.unit || '—'}</td>
          </tr>`).join('')
      : `<tr><td colspan="3" style="padding:8px 12px;color:#666;font-style:italic">${pricingStr || 'See details above'}</td></tr>`;

    const tableStyle = `width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px`;
    const thStyle    = `padding:8px 12px;background:#222;color:#888;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;text-align:left`;
    const totalRowStyle = `background:#1a1a1a`;

    // ── CUSTOMER EMAIL ──────────────────────────────────────────────────────
    const customerHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:20px 32px">
        <span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
      </td>
    </tr>
  </table>

  <!-- Hero -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:#4caf50;padding:36px 32px;text-align:center">
        <div style="font-size:48px;margin-bottom:8px">✅</div>
        <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:2px;color:#fff;text-transform:uppercase">You're All Set!</h1>
        <p style="margin:10px 0 0;color:rgba(255,255,255,0.75);font-size:15px">Your deposit is paid and your appointment is locked in.</p>
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">

    <!-- Appointment -->
    <tr><td style="padding:28px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Your Appointment</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Date</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${date || '—'}</span>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Time Window</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${time || '—'}</span>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #222">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Est. Duration</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${duration ? duration + ' hours' : '—'}</span>
        </td></tr>
        <tr><td style="padding:12px 16px">
          <span style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#888">Address</span><br>
          <span style="color:#f5f5f0;font-weight:700;font-size:15px">${address || 'Clarksville, TN'}</span>
        </td></tr>
      </table>
    </td></tr>

    <!-- Service Summary -->
    <tr><td style="padding:24px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Service Summary</p>
      <table style="${tableStyle};background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <thead>
          <tr>
            <th style="${thStyle}">Item</th>
            <th style="${thStyle};text-align:center">Qty</th>
            <th style="${thStyle};text-align:right">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="${totalRowStyle}">
            <td colspan="2" style="padding:12px;font-weight:900;font-size:14px;color:#f5f5f0;letter-spacing:1px;text-transform:uppercase">Estimated Total</td>
            <td style="padding:12px;font-weight:900;font-size:20px;color:#E31212;text-align:right">$${total || '—'}</td>
          </tr>
        </tfoot>
      </table>
    </td></tr>

    <!-- Payment Breakdown -->
    <tr><td style="padding:16px 32px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border-left:3px solid #333;padding:14px 16px">
        <tr>
          <td style="color:#4caf50;font-weight:700;font-size:13px;padding:3px 0">✅ Deposit charged today</td>
          <td style="color:#4caf50;font-weight:700;font-size:13px;text-align:right">$${deposit || '—'}</td>
        </tr>
        <tr>
          <td style="color:#888;font-size:13px;padding:3px 0">Balance due after service</td>
          <td style="color:#888;font-size:13px;text-align:right">$${balance || '—'}</td>
        </tr>
        <tr>
          <td colspan="2" style="color:#555;font-size:12px;padding-top:8px">Final price confirmed on-site before work begins. No surprise fees, ever.</td>
        </tr>
      </table>
    </td></tr>

    <!-- What Happens Next -->
    <tr><td style="padding:24px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">What Happens Next</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        ${[
          ['1', `Our crew will <strong style="color:#f5f5f0">call or text you 30–60 minutes before arrival</strong> on the day of your appointment.`],
          ['2', `We'll walk through the job together and <strong style="color:#f5f5f0">confirm the final price</strong> before any work begins.`],
          ['3', `Once the job is done, you pay the remaining balance. We accept <strong style="color:#f5f5f0">cash, card, Venmo, or CashApp</strong>.`],
          ['4', `Enjoy your <strong style="color:#f5f5f0">clutter-free space!</strong> 🎉`]
        ].map(([num, text]) => `
          <tr><td style="padding:12px 16px;border-bottom:1px solid #222;color:#aaa;font-size:14px;line-height:1.6">
            <span style="display:inline-block;background:#E31212;color:#fff;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-weight:900;font-size:12px;margin-right:10px">${num}</span>
            ${text}
          </td></tr>`).join('')}
      </table>
    </td></tr>

    <!-- Stripe Receipt -->
    <tr><td style="padding:16px 32px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #1e1e1e;padding:12px 16px">
        <tr>
          <td style="color:#555;font-size:11px;letter-spacing:1px">STRIPE PAYMENT ID</td>
          <td style="color:#444;font-size:11px;font-family:monospace;text-align:right">${stripeId || '—'}</td>
        </tr>
      </table>
    </td></tr>

    <!-- Questions -->
    <tr><td style="padding:24px 32px 0">
      <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Questions?</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <tr><td style="padding:16px">
          <a href="tel:9315610431" style="display:inline-block;margin:4px 8px 4px 0;background:#E31212;color:#fff;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase">📞 (931) 561-0431</a>
          <a href="sms:9315610431" style="display:inline-block;margin:4px 8px 4px 0;background:#2a2a2a;color:#f5f5f0;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border:1px solid #333">💬 Text Us</a>
          <a href="mailto:junkreliefllc@gmail.com" style="display:inline-block;margin:4px 0;background:#2a2a2a;color:#f5f5f0;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border:1px solid #333">✉️ Email</a>
        </td></tr>
      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:32px;text-align:center;color:#444;font-size:12px;line-height:1.8">
      <strong style="color:#666">Junk Relief LLC</strong> · Clarksville, TN<br>
      Payments processed securely by Stripe. We never store your card details.<br>
      <span style="color:#333">© ${new Date().getFullYear()} Junk Relief LLC. All rights reserved.</span>
    </td></tr>

  </table>
</body>
</html>`;

    // ── OWNER EMAIL ─────────────────────────────────────────────────────────
    const ownerHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">

  <!-- Header -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:#0a0a0a;border-bottom:3px solid #E31212;padding:16px 24px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:20px;font-weight:900;letter-spacing:3px;color:#f5f5f0">JUNK <span style="color:#E31212">RELIEF</span> LLC</span>
        &nbsp;&nbsp;
        <span style="background:#E31212;color:#fff;font-size:10px;font-weight:800;letter-spacing:2px;padding:4px 10px;text-transform:uppercase">Owner View</span>
      </td>
    </tr>
  </table>

  <!-- Alert -->
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="background:#E31212;padding:20px 24px">
        <h1 style="margin:0;font-size:22px;font-weight:900;letter-spacing:2px;color:#fff;text-transform:uppercase">🚨 New Paid Booking</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">Deposit collected from ${customerName} — review details below.</p>
      </td>
    </tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">

    <!-- Priority Stats -->
    <tr><td style="padding:20px 24px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222">
        <tr>
          ${[
            ['Date', date || '—', '#E31212'],
            ['Time', time || '—', '#f5f5f0'],
            ['Duration', duration ? duration + ' hr' : '—', '#f5f5f0'],
            ['Deposit Paid', deposit ? '$' + deposit : '$—', '#4caf50'],
            ['Balance Due', balance ? '$' + balance : '$—', '#f5a623']
          ].map(([label, val, color]) => `
            <td style="padding:14px 10px;text-align:center;border-right:1px solid #222">
              <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#555;margin-bottom:4px">${label}</div>
              <div style="font-size:17px;font-weight:900;color:${color};letter-spacing:0.5px">${val}</div>
            </td>`).join('')}
        </tr>
      </table>
    </td></tr>

    <!-- Customer Info -->
    <tr><td style="padding:20px 24px 0">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Customer</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        ${[
          ['Name', customerName || '—'],
          ['Phone', phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="color:#E31212;font-weight:700">${phone}</a>` : '—'],
          ['Email', email ? `<a href="mailto:${email}" style="color:#E31212">${email}</a>` : '—'],
          ['Address', address ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}" style="color:#E31212">${address}</a>` : 'Not provided']
        ].map(([label, val]) => `
          <tr><td style="padding:10px 16px;border-bottom:1px solid #222">
            <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#555">${label}</span><br>
            <span style="color:#f5f5f0;font-weight:600;font-size:14px">${val}</span>
          </td></tr>`).join('')}
      </table>
    </td></tr>

    <!-- Job Scope -->
    <tr><td style="padding:20px 24px 0">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Job Scope</p>
      <table style="${tableStyle};background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <thead>
          <tr>
            <th style="${thStyle}">Item</th>
            <th style="${thStyle};text-align:center">Qty</th>
            <th style="${thStyle};text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="${totalRowStyle}">
            <td colspan="2" style="padding:12px;font-weight:900;color:#f5f5f0;font-size:13px;letter-spacing:1px;text-transform:uppercase">Estimated Total</td>
            <td style="padding:12px;font-weight:900;font-size:18px;color:#E31212;text-align:right">$${total || '—'}</td>
          </tr>
        </tfoot>
      </table>
    </td></tr>

    <!-- Customer Notes -->
    <tr><td style="padding:20px 24px 0">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Customer Notes</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#111;border-left:3px solid #f5a623">
        <tr><td style="padding:14px 16px;color:${notes ? '#ccc' : '#444'};font-size:14px;font-style:${notes ? 'normal' : 'italic'};line-height:1.7">
          ${notes ? notes.replace(/\n/g,'<br>') : 'No special notes provided.'}
        </td></tr>
      </table>
    </td></tr>

    <!-- Payment Info -->
    <tr><td style="padding:20px 24px 0">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Payment</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        <tr><td style="padding:10px 16px;border-bottom:1px solid #222">
          <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#555">Status</span><br>
          <span style="background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,0.3);color:#4caf50;font-weight:700;font-size:13px;padding:3px 10px;display:inline-block;margin-top:4px">✅ Deposit Paid</span>
        </td></tr>
        <tr><td style="padding:10px 16px;border-bottom:1px solid #222">
          <span style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#555">Stripe Payment ID</span><br>
          <span style="color:#555;font-family:monospace;font-size:12px">${stripeId || '—'}</span>
        </td></tr>
        <tr><td style="padding:10px 16px">
          <a href="https://dashboard.stripe.com/payments/${stripeId || ''}" style="display:inline-block;background:#2a2a2a;color:#f5f5f0;padding:9px 16px;font-weight:800;font-size:12px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border:1px solid #333">🔗 View in Stripe Dashboard →</a>
        </td></tr>
      </table>
    </td></tr>

    <!-- Day-Of Checklist -->
    <tr><td style="padding:20px 24px 0">
      <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#E31212">Day-Of Checklist</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border:1px solid #222;border-top:3px solid #E31212">
        ${[
          'Call/text customer 30–60 min before arrival',
          'Confirm address and access (gate code, driveway, etc.)',
          'Review item list with customer before starting',
          'Confirm final price before any work begins',
          'Complete the job',
          'Collect balance payment (cash, card, Venmo, CashApp)',
          'Take before/after photos',
          'Ask for a Google review ⭐'
        ].map(item => `
          <tr><td style="padding:10px 16px;border-bottom:1px solid #222;color:#ccc;font-size:13px">
            ☐ &nbsp;${item}
          </td></tr>`).join('')}
      </table>
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:28px 24px;text-align:center;color:#333;font-size:11px;line-height:1.8">
      JUNK RELIEF LLC · Clarksville, TN · Internal Owner Notification<br>
      Booked ${new Date().toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short'})}
    </td></tr>

  </table>
</body>
</html>`;

    // ── Send both emails via Resend ──────────────────────────────────────────
    async function sendEmail({ to, subject, html }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: `Junk Relief LLC <${FROM_EMAIL}>`,
          to: [to],
          subject,
          html
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(data));
      return data;
    }

    const [customerResult, ownerResult] = await Promise.all([
      sendEmail({
        to: email,
        subject: `✅ Booking Confirmed — ${date || 'Your Junk Relief Appointment'}`,
        html: customerHtml
      }),
      sendEmail({
        to: OWNER_EMAIL,
        subject: `🚨 New Paid Booking — ${customerName} — ${date || 'Date TBD'}`,
        html: ownerHtml
      })
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        customerEmailId: customerResult.id,
        ownerEmailId: ownerResult.id
      })
    };

  } catch (err) {
    console.error('send-confirmation error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
