// netlify/functions/view-photo.js
// Serves a single photo's bytes, but ONLY if the request includes a
// valid, non-expired signed link (key + expires + sig — see photo-utils.js).
// This is what admin.html's <img> tags and the lightbox point at.

const { getStore } = require('@netlify/blobs');
const { verify } = require('./photo-utils');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { key, expires, sig } = event.queryStringParameters || {};

    const check = verify(key, expires, sig);
    if (!check.valid) {
      return { statusCode: 403, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: check.reason }) };
    }

    const store = getStore({
      name: 'photos',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!result) {
      return { statusCode: 404, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Photo not found' }) };
    }

    const mimeType = (result.metadata && result.metadata.mimeType) || 'image/jpeg';
    const base64Body = Buffer.from(result.data).toString('base64');

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': mimeType,
        'Cache-Control': 'private, max-age=300'
      },
      body: base64Body,
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('view-photo error:', err.message);
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};
