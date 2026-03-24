const { getDb } = require('../../_db');

module.exports = async function handler(req, res) {
  const sql = getDb();
  const { id } = req.query;

  if (req.method === 'GET') {
    const views = await sql`
      SELECT * FROM views WHERE video_id = ${id} ORDER BY viewed_at DESC
    `;
    return res.json(views);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
