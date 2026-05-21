// netlify/functions/get-config.js
// Exposes public (non-secret) config values to the frontend.
// Add STRIPE_PUBLISHABLE_KEY to your Netlify environment variables.

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    },
    body: JSON.stringify({
      stripePk: process.env.STRIPE_PUBLISHABLE_KEY || ''
    })
  };
};
