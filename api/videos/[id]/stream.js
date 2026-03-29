const { getDb, securityHeaders } = require('../../_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  const sql = getDb();
  const { id } = req.query;

  const rows = await sql`SELECT blob_url FROM videos WHERE id = ${id}`;
  if (rows.length === 0) return res.status(404).send('Not found');

  // Validate redirect target is Cloudinary to prevent open redirect
  try {
    const url = new URL(rows[0].blob_url);
    if (!url.hostname.endsWith('.cloudinary.com') && url.hostname !== 'res.cloudinary.com') {
      return res.status(400).send('Invalid video source');
    }
  } catch {
    return res.status(400).send('Invalid video URL');
  }

  res.redirect(302, rows[0].blob_url);
};
