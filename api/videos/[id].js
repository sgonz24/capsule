const { getDb, hashPassword, requireAdmin, securityHeaders } = require('../_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (!requireAdmin(req, res)) return;

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

    // Hash password if provided, keep existing if not changed
    let passwordValue = v.share_password;
    if (body.share_password !== undefined) {
      passwordValue = body.share_password ? hashPassword(body.share_password) : null;
    }

    const safeTitle = body.title !== undefined ? String(body.title).slice(0, 200) : v.title;
    const safeFolder = body.folder !== undefined
      ? String(body.folder).slice(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '') || 'all'
      : v.folder;

    await sql`
      UPDATE videos SET
        title = ${safeTitle},
        folder = ${safeFolder},
        is_shared = ${body.is_shared ?? v.is_shared},
        share_password = ${passwordValue},
        share_expires = ${body.share_expires ?? v.share_expires},
        allow_download = ${body.allow_download ?? v.allow_download}
      WHERE id = ${id}
    `;
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const existing = await sql`SELECT * FROM videos WHERE id = ${id}`;
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    await sql`DELETE FROM videos WHERE id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
