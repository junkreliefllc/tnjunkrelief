// netlify/functions/list-photos.js
// Given a parentType + parentId (e.g. a bookingId), returns a list of
// that submission's photos as ready-to-use signed URLs. No password
// required to call this — matches the same "viewing is open, changing
// things requires a password" pattern as bookings.js. The actual
// protection lives in the signed links themselves (see photo-utils.js):
// each link only works for ~10 minutes and can't be tampered with.

const { getStore } = require('@netlify/blobs');
const { buildSignedUrl } = require('./photo-utils');

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
    const { parentType, parentId } = JSON.parse(event.body);

    if (!parentType || !parentId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parentType or parentId' }) };
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(parentId)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid parentId format' }) };
    }

    const store = getStore({
      name: 'photos',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const indexKey = `${parentType}_${parentId}/index`;
    let photoList = [];
    try {
      const rawIndex = await store.get(indexKey);
      if (rawIndex) photoList = JSON.parse(rawIndex);
    } catch (e) {
      photoList = [];
    }

    const siteUrl = process.env.SITE_URL || (event.headers && (event.headers.host || event.headers.Host) ? `https://${event.headers.host || event.headers.Host}` : 'https://tnjunkrelief.com');
    const photos = photoList.map(key => ({
      key,
      url: buildSignedUrl(key, siteUrl)
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, photos }) };
  } catch (err) {
    console.error('list-photos error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
