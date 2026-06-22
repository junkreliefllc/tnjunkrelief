// netlify/functions/upload-photo.js
// Stores one photo (already resized in the browser) to Netlify Blobs.
// Called once per photo — the frontend loops through selected photos
// and calls this function for each one.
//
// Photos are organized under a parent ID so they can all be found later:
//   booking_bk_abc123/photo_1234567_0.jpg
//   lead_ld_xyz789/photo_1234567_0.jpg
// The parentType + parentId together form that folder-like prefix.

const { getStore } = require('@netlify/blobs');

const MAX_PHOTOS_PER_SUBMISSION = 12;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2MB ceiling per photo after resize.
// Why 2MB: Netlify base64-encodes binary request bodies, which adds ~30%
// overhead and caps the effective binary request at ~4.5MB. A 2MB photo
// becomes ~2.7MB encoded — comfortably under that limit. Resized 1200px
// JPEGs are normally 150-500KB anyway, so this never rejects a real photo,
// it just guards against an unexpectedly huge one slipping through.

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
    const { parentType, parentId, photoIndex, dataUrl, filename } = JSON.parse(event.body);

    if (!parentType || !parentId || photoIndex === undefined || !dataUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    if (parentType !== 'booking' && parentType !== 'lead') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'parentType must be booking or lead' }) };
    }
    if (photoIndex < 0 || photoIndex >= MAX_PHOTOS_PER_SUBMISSION) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `photoIndex must be 0-${MAX_PHOTOS_PER_SUBMISSION - 1}` }) };
    }
    // parentId should always be a server-generated bk_xxx or ld_xxx id.
    // Validating the shape here is defense in depth — it flows directly
    // into storage key names, so this guards against it ever carrying
    // slashes or other structural characters from an unexpected caller.
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(parentId)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid parentId format' }) };
    }

    // dataUrl looks like: data:image/jpeg;base64,/9j/4AAQ...
    const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid image data' }) };
    }
    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_PHOTO_BYTES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Photo too large after resize' }) };
    }

    const store = getStore({
      name: 'photos',
      consistency: 'strong',
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN
    });

    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const safeFilename = (filename || `photo_${photoIndex}`)
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .replace(/\.{2,}/g, '_')   // collapse repeated dots (e.g. from "../../")
      .replace(/^[._-]+|[._-]+$/g, '') // trim leading/trailing dots, underscores, hyphens
      .substring(0, 80) || `photo_${photoIndex}`; // guard against an empty result after stripping
    const key = `${parentType}_${parentId}/${photoIndex}_${safeFilename}.${ext}`;

    await store.set(key, buffer, { metadata: { mimeType, uploadedAt: new Date().toISOString() } });

    // Maintain a small index of photo keys per parent, so admin can list
    // "all photos for this booking" without scanning the whole store.
    const indexKey = `${parentType}_${parentId}/index`;
    let photoList = [];
    try {
      const rawIndex = await store.get(indexKey);
      if (rawIndex) photoList = JSON.parse(rawIndex);
    } catch (e) {
      photoList = [];
    }
    if (!photoList.includes(key)) {
      photoList.push(key);
      await store.set(indexKey, JSON.stringify(photoList));
    }

    // If this photo belongs to a booking, also stamp a photoCount onto
    // that booking's own record. This lets admin show a "📷 3" badge on
    // the booking list using data it's already loading anyway — no
    // separate photo-lookup request needed per booking.
    if (parentType === 'booking') {
      try {
        await syncBookingPhotoCount(parentId, photoList.length);
      } catch (syncErr) {
        // Non-fatal — the photo itself is safely stored either way,
        // worst case the badge just doesn't show for this booking.
        console.error('Could not sync photoCount to booking:', syncErr.message);
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, key }) };
  } catch (err) {
    console.error('upload-photo error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function syncBookingPhotoCount(bookingId, photoCount) {
  const bookingsStore = getStore({
    name: 'bookings',
    consistency: 'strong',
    siteID: process.env.BLOBS_SITE_ID,
    token: process.env.BLOBS_TOKEN
  });

  const raw = await bookingsStore.get('all-bookings');
  if (!raw) return;
  const bookings = JSON.parse(raw);

  for (const dateKey of Object.keys(bookings)) {
    const match = bookings[dateKey].find(b => b.bookingId === bookingId);
    if (match) {
      match.photoCount = photoCount;
      await bookingsStore.set('all-bookings', JSON.stringify(bookings));
      return;
    }
  }
}
