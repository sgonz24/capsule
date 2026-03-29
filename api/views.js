const { getDb, securityHeaders } = require('./_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);

  if (req.method === 'POST') {
    const sql = getDb();
    const { video_id, viewer_name, watch_duration, total_percent } = req.body;

    if (!video_id || typeof video_id !== 'string' || video_id.length > 20) {
      return res.status(400).json({ error: 'Invalid video_id' });
    }

    const safeName = String(viewer_name || 'Anonymous').slice(0, 100);
    const safeDuration = Math.max(0, Math.min(parseInt(watch_duration) || 0, 86400));
    const safePercent = Math.max(0, Math.min(parseFloat(total_percent) || 0, 100));

    const viewerIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

    await sql`
      INSERT INTO views (video_id, viewer_ip, viewer_name, user_agent, watch_duration, total_percent)
      VALUES (${video_id}, ${viewerIp}, ${safeName}, ${userAgent},
              ${safeDuration}, ${safePercent})
    `;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
