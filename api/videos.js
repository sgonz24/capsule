const { getDb, generateShareId, generateId } = require('./_db');

module.exports = async function handler(req, res) {
  const sql = getDb();

  // GET /api/videos — list all
  if (req.method === 'GET') {
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
    const { title, duration, folder, cloudinaryUrl, fileSize } = req.body;

    if (!cloudinaryUrl) {
      return res.status(400).json({ error: 'cloudinaryUrl required' });
    }

    const id = generateId();
    const shareId = generateShareId();

    await sql`
      INSERT INTO videos (id, share_id, title, blob_url, duration, folder, file_size)
      VALUES (${id}, ${shareId}, ${title || 'Untitled'}, ${cloudinaryUrl},
              ${parseInt(duration) || 0}, ${folder || 'all'}, ${parseInt(fileSize) || 0})
    `;

    return res.json({ id, shareId, title });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
