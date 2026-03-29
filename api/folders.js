const { getDb, requireAdmin, securityHeaders } = require('./_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (!requireAdmin(req, res)) return;

  const sql = getDb();

  if (req.method === 'GET') {
    const rows = await sql`SELECT name FROM folders ORDER BY name`;
    return res.json(rows.map(f => f.name));
  }

  if (req.method === 'POST') {
    const { name } = req.body;
    const safeName = String(name || '').trim().slice(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '');
    if (!safeName) return res.status(400).json({ error: 'Name required' });
    try {
      await sql`INSERT INTO folders (name) VALUES (${safeName}) ON CONFLICT DO NOTHING`;
      return res.json({ ok: true });
    } catch {
      return res.status(409).json({ error: 'Already exists' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
