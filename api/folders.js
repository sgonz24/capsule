const { getDb } = require('./_db');

module.exports = async function handler(req, res) {
  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`SELECT name FROM folders ORDER BY name`;
    return res.json(rows.map(f => f.name));
  }

  if (req.method === 'POST') {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    try {
      await sql`INSERT INTO folders (name) VALUES (${name.trim()}) ON CONFLICT DO NOTHING`;
      return res.json({ ok: true });
    } catch {
      return res.status(409).json({ error: 'Already exists' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
