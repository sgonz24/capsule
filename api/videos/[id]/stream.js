const { getDb } = require('../../_db');

module.exports = async function handler(req, res) {
  const sql = getDb();
  const { id } = req.query;

  const rows = await sql`SELECT blob_url FROM videos WHERE id = ${id}`;
  if (rows.length === 0) return res.status(404).send('Not found');

  // Redirect to Cloudinary URL
  res.redirect(302, rows[0].blob_url);
};
