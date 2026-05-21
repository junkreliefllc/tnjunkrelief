// netlify/functions/admin-auth.js
// Verifies admin password server-side.
// Set ADMIN_PASSWORD in your Netlify environment variables.
// Default fallback is 'Jaxon111' — change it in Netlify env vars anytime.

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
    const { password } = JSON.parse(event.body);
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Jaxon111';

    if (password === ADMIN_PASSWORD) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    } else {
      return { statusCode: 401, headers, body: JSON.stringify({ ok: false }) };
    }
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
