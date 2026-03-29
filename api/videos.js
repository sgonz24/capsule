const { getDb, generateShareId, generateId, requireAdmin, securityHeaders } = require('./_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  const sql = getDb();

  // GET /api/videos — list all
  if (req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const videos = await sql`
      SELECT v.*, COUNT(vw.id)::int as view_count,
        COALESCE(SUM(vw.watch_duration), 0)::int as total_watch_time
      FROM videos v
      LEFT JOIN views vw ON v.id = vw.video_id
      GROUP BY v.id
      ORDER BY v.created_at DESC
    `;
    return res.json(videos);
  }

  // POST /api/videos — save video metadata (video already uploaded to Cloudinary)
  if (req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { title, duration, folder, cloudinaryUrl, fileSize } = req.body;

    if (!cloudinaryUrl) {
      return res.status(400).json({ error: 'cloudinaryUrl required' });
    }

    // Validate Cloudinary URL
    try {
      const url = new URL(cloudinaryUrl);
      if (!url.hostname.endsWith('.cloudinary.com') && url.hostname !== 'res.cloudinary.com') {
        return res.status(400).json({ error: 'Invalid video URL' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const safeTitle = String(title || 'Untitled').slice(0, 200);
    const safeFolder = String(folder || 'all').slice(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '');

    const id = generateId();
    const shareId = generateShareId();

    await sql`
      INSERT INTO videos (id, share_id, title, blob_url, duration, folder, file_size)
      VALUES (${id}, ${shareId}, ${safeTitle}, ${cloudinaryUrl},
              ${parseInt(duration) || 0}, ${safeFolder || 'all'}, ${parseInt(fileSize) || 0})
    `;

    return res.json({ id, shareId, title: safeTitle });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
