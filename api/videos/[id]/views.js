const { getDb, requireAdmin, securityHeaders } = require('../../_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (!requireAdmin(req, res)) return;

  const sql = getDb();
  const { id } = req.query;

  if (req.method === 'GET') {
    const views = await sql`
      SELECT id, video_id, viewer_name, watch_duration, total_percent, viewed_at
      FROM views WHERE video_id = ${id} ORDER BY viewed_at DESC
    `;
    return res.json(views);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
