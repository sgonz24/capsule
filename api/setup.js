const { initDb, requireAdmin, securityHeaders } = require('./_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireAdmin(req, res)) return;

  try {
    await initDb();
    res.json({ ok: true, message: 'Database tables created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
