const { getDb } = require('./_db');

module.exports = async function handler(req, res) {
  const sql = getDb();

  if (req.method === 'POST') {
    const { video_id, viewer_name, watch_duration, total_percent } = req.body;
    const viewerIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    await sql`
      INSERT INTO views (video_id, viewer_ip, viewer_name, user_agent, watch_duration, total_percent)
      VALUES (${video_id}, ${viewerIp}, ${viewer_name || 'Anonymous'}, ${userAgent},
              ${watch_duration || 0}, ${total_percent || 0})
    `;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
