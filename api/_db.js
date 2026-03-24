const { neon } = require('@neondatabase/serverless');

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
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function generateId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

module.exports = { getDb, initDb, generateShareId, generateId };
