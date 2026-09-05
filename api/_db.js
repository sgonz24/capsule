const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

let sql;

function getDb() {
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

async function initDb() {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      share_id TEXT UNIQUE,
      title TEXT NOT NULL,
      blob_url TEXT,
      duration INTEGER DEFAULT 0,
      folder TEXT DEFAULT 'all',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      file_size INTEGER DEFAULT 0,
      is_shared INTEGER DEFAULT 0,
      share_password TEXT,
      share_expires TIMESTAMPTZ,
      allow_download INTEGER DEFAULT 1
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS views (
      id SERIAL PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      viewer_ip TEXT,
      viewer_name TEXT,
      user_agent TEXT,
      watch_duration INTEGER DEFAULT 0,
      total_percent REAL DEFAULT 0,
      viewed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_views_video ON views(video_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_share_id ON videos(share_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS folders (
      name TEXT PRIMARY KEY
    )
  `;
  await sql`INSERT INTO folders (name) VALUES ('all') ON CONFLICT DO NOTHING`;
}

function generateShareId() {
  const bytes = crypto.randomBytes(6);
  return bytes.toString('base64url').slice(0, 8);
}

function generateId() {
  const bytes = crypto.randomBytes(9);
  return bytes.toString('base64url').slice(0, 12);
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64);
  return 'scrypt:' + salt + ':' + derived.toString('hex');
}

function verifyPassword(plain, stored) {
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const check = crypto.scryptSync(plain, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), check);
  }
  // Legacy SHA-256 fallback for existing hashes
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.createHash('sha256').update(salt + plain).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function requireAdmin(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Server misconfigured: ADMIN_TOKEN not set' });
    return false;
  }
  const provided = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided === token) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}

module.exports = { getDb, initDb, generateShareId, generateId, hashPassword, verifyPassword, requireAdmin, securityHeaders };
