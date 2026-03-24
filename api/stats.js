const { getDb } = require('./_db');

module.exports = async function handler(req, res) {
  const sql = getDb();

  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const [totalVideos] = await sql`SELECT COUNT(*)::int as count FROM videos`;
  const [totalViews] = await sql`SELECT COUNT(*)::int as count FROM views`;
  const [totalWatchTime] = await sql`SELECT COALESCE(SUM(watch_duration), 0)::int as total FROM views`;
  const [uniqueViewers] = await sql`SELECT COUNT(DISTINCT viewer_ip)::int as count FROM views`;

  const topVideos = await sql`
    SELECT v.id, v.title, v.share_id, COUNT(vw.id)::int as views, v.duration,
      COALESCE(AVG(vw.total_percent), 0) as avg_watch_pct
    FROM videos v
    LEFT JOIN views vw ON v.id = vw.video_id
    GROUP BY v.id, v.title, v.share_id, v.duration
    ORDER BY views DESC
    LIMIT 10
  `;

  const recentViews = await sql`
    SELECT vw.*, v.title as video_title
    FROM views vw
    JOIN videos v ON vw.video_id = v.id
    ORDER BY vw.viewed_at DESC
    LIMIT 20
  `;

  res.json({
    totalVideos: totalVideos.count,
    totalViews: totalViews.count,
    totalWatchTime: totalWatchTime.total,
    uniqueViewers: uniqueViewers.count,
    topVideos,
    recentViews
  });
};
