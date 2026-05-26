// netlify/functions/contact.js
// Receives contact form submissions and emails them to the owner.

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
    const { name, phone, email, subject, message } = JSON.parse(event.body);

    if (!name || !email || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const OWNER_EMAIL = process.env.OWNER_EMAIL || 'junkreliefllc@gmail.com';
    const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    if (!RESEND_API_KEY) throw new Error('Email service not configured.');

    const subjectLabels = {
      quote: 'Quote Request',
      estate: 'Estate Cleanout',
      commercial: 'Business / Commercial',
      recurring: 'Recurring Service',
      question: 'General Question',
      other: 'Other'
    };
    const subjectLabel = subjectLabels[subject] || 'Contact Form';

    const ownerHtml = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#E31212;padding:20px 24px">
      <h1 style="margin:0;font-size:20px;font-weight:900;color:#fff;letter-spacing:1px;text-transform:uppercase">💬 New Contact Form Message</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px">${subjectLabel} from ${name}</p>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
    <tr><td style="background:#1a1a1a;border:1px solid #222;padding:24px">
      <table width="100%" cellpadding="0" cellspacing="0">
        ${[
          ['Name', name],
          ['Phone', phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="color:#E31212;font-weight:700;text-decoration:none">${phone}</a>` : 'Not provided'],
          ['Email', `<a href="mailto:${email}" style="color:#E31212;font-weight:700;text-decoration:none">${email}</a>`],
          ['Subject', subjectLabel]
        ].map(([label, val]) => `
          <tr><td style="padding:10px 0;border-bottom:1px solid #222">
            <span style="font-size:10px;color:#555;text-transform:uppercase;letter-spacing:1.5px;font-weight:700">${label}</span><br>
            <span style="color:#f5f5f0;font-weight:600;font-size:15px">${val}</span>
          </td></tr>`).join('')}
      </table>
      <div style="margin-top:1.2rem;padding:14px 16px;background:#111;border-left:3px solid #E31212;color:#ccc;font-size:14px;line-height:1.7;white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </td></tr>
    <tr><td style="padding:16px 24px;background:#0a0a0a;text-align:center">
      ${phone ? `<a href="tel:${phone.replace(/\D/g,'')}" style="display:inline-block;background:#E31212;color:#fff;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;margin:4px">📞 Call Back</a>` : ''}
      <a href="mailto:${email}" style="display:inline-block;background:#2a2a2a;color:#f5f5f0;padding:10px 18px;font-weight:800;font-size:13px;letter-spacing:1px;text-decoration:none;text-transform:uppercase;border:1px solid #333;margin:4px">✉️ Reply</a>
    </td></tr>
    <tr><td style="padding:24px;text-align:center;color:#333;font-size:11px">
      Junk Relief LLC · Contact Form · ${new Date().toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short'})}
    </td></tr>
  </table>
</body></html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: `Junk Relief Contact <${FROM_EMAIL}>`,
        to: [OWNER_EMAIL],
        reply_to: email,
        subject: `💬 ${subjectLabel} from ${name}`,
        html: ownerHtml
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error('Resend error: ' + JSON.stringify(data));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };

  } catch(err) {
    console.error('contact.js error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
