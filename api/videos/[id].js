const { getDb } = require('../_db');

module.exports = async function handler(req, res) {
  const sql = getDb();
  const { id } = req.query;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT v.*, COUNT(vw.id)::int as view_count
      FROM videos v
      LEFT JOIN views vw ON v.id = vw.video_id
      WHERE v.id = ${id}
      GROUP BY v.id
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    return res.json(rows[0]);
  }

  if (req.method === 'PATCH') {
    const body = req.body;
    const existing = await sql`SELECT * FROM videos WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    const v = existing[0];
    await sql`
      UPDATE videos SET
        title = ${body.title ?? v.title},
        folder = ${body.folder ?? v.folder},
        is_shared = ${body.is_shared ?? v.is_shared},
        share_password = ${body.share_password !== undefined ? body.share_password : v.share_password},
        share_expires = ${body.share_expires ?? v.share_expires},
        allow_download = ${body.allow_download ?? v.allow_download}
      WHERE id = ${id}
    `;
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const existing = await sql`SELECT * FROM videos WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    // Note: Cloudinary video remains (cleanup can be done via Cloudinary dashboard)
    await sql`DELETE FROM views WHERE video_id = ${id}`;
    await sql`DELETE FROM videos WHERE id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
