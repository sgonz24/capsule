const { getDb, requireAdmin, securityHeaders } = require('../_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (!requireAdmin(req, res)) return;

  const sql = getDb();
  const { name } = req.query;

  if (req.method === 'DELETE') {
    if (name === 'all') return res.status(400).json({ error: 'Cannot delete default folder' });
    await sql`UPDATE videos SET folder = 'all' WHERE folder = ${name}`;
    await sql`DELETE FROM folders WHERE name = ${name}`;
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
