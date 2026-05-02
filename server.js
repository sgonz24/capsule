const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3847;

// ——— Database ———
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
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
    `);
    await client.query(`
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_views_video ON views(video_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_share_id ON videos(share_id)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS folders (
        name TEXT PRIMARY KEY
      )
    `);
    await client.query(`INSERT INTO folders (name) VALUES ('all') ON CONFLICT DO NOTHING`);
    console.log('  Database initialized');
  } finally {
    client.release();
  }
}

// ——— Helpers ———
function generateId() {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

function generateShareId() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
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
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.createHash('sha256').update(salt + plain).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function requireAdmin(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) { res.status(503).json({ error: 'ADMIN_TOKEN not set' }); return false; }
  const provided = req.headers['x-admin-token'] || req.headers['authorization']?.replace('Bearer ', '');
  if (provided === token) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ——— Rate limiter (in-memory) ———
const rateLimits = new Map();
function rateLimit(ip, max = 20) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.reset) rateLimits.delete(ip);
  }
}, 300000);

// ——— Middleware ———
app.use(securityHeaders);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ——— Health Check ———
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ——— DB Setup ———
app.post('/api/setup', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    await initDb();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ——— Videos ———
app.get('/api/videos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await pool.query(`
    SELECT v.*, COUNT(vw.id)::int as view_count,
      COALESCE(SUM(vw.watch_duration), 0)::int as total_watch_time
    FROM videos v
    LEFT JOIN views vw ON v.id = vw.video_id
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `);
  res.json(rows);
});

app.post('/api/videos', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { title, duration, folder, cloudinaryUrl, fileSize } = req.body;

  if (!cloudinaryUrl) return res.status(400).json({ error: 'cloudinaryUrl required' });

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

  await pool.query(
    `INSERT INTO videos (id, share_id, title, blob_url, duration, folder, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, shareId, safeTitle, cloudinaryUrl, parseInt(duration) || 0, safeFolder || 'all', parseInt(fileSize) || 0]
  );

  res.json({ id, shareId, title: safeTitle });
});

app.get('/api/videos/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await pool.query(
    `SELECT v.*, COUNT(vw.id)::int as view_count
     FROM videos v LEFT JOIN views vw ON v.id = vw.video_id
     WHERE v.id = $1 GROUP BY v.id`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.patch('/api/videos/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { title, folder, is_shared, share_password, share_expires, allow_download } = req.body;
  const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  const v = rows[0];
  const hashedPw = share_password ? hashPassword(share_password) : (share_password === null ? null : v.share_password);

  await pool.query(
    `UPDATE videos SET
      title = COALESCE($1, title),
      folder = COALESCE($2, folder),
      is_shared = COALESCE($3, is_shared),
      share_password = $4,
      share_expires = COALESCE($5, share_expires),
      allow_download = COALESCE($6, allow_download)
     WHERE id = $7`,
    [title, folder, is_shared, hashedPw, share_expires, allow_download, req.params.id]
  );

  res.json({ ok: true });
});

app.delete('/api/videos/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await pool.query('SELECT * FROM videos WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });

  await pool.query('DELETE FROM views WHERE video_id = $1', [req.params.id]);
  await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ——— Video Streaming (redirect to Cloudinary) ———
app.get('/api/videos/:id/stream', async (req, res) => {
  const { rows } = await pool.query('SELECT blob_url FROM videos WHERE id = $1', [req.params.id]);
  if (!rows[0] || !rows[0].blob_url) return res.status(404).send('Not found');

  try {
    const url = new URL(rows[0].blob_url);
    if (!url.hostname.endsWith('.cloudinary.com') && url.hostname !== 'res.cloudinary.com') {
      return res.status(400).send('Invalid video URL');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  res.redirect(302, rows[0].blob_url);
});

// ——— Per-video Views ———
app.get('/api/videos/:id/views', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await pool.query(
    'SELECT * FROM views WHERE video_id = $1 ORDER BY viewed_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// ——— Views (public) ———
app.post('/api/views', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  if (!rateLimit(ip)) return res.status(429).json({ error: 'Rate limited' });

  const { video_id, viewer_name, watch_duration, total_percent } = req.body;
  if (!video_id || String(video_id).length > 20) return res.status(400).json({ error: 'Invalid video_id' });

  const safeName = String(viewer_name || 'Anonymous').slice(0, 100);
  const safeDuration = Math.max(0, Math.min(parseInt(watch_duration) || 0, 86400));
  const safePct = Math.max(0, Math.min(parseFloat(total_percent) || 0, 100));

  await pool.query(
    `INSERT INTO views (video_id, viewer_ip, viewer_name, user_agent, watch_duration, total_percent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [video_id, ip, safeName, req.headers['user-agent'], safeDuration, safePct]
  );

  res.json({ ok: true });
});

// ——— Stats ———
app.get('/api/stats', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const [totals, topVideos, recentViews] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM videos)::int as "totalVideos",
        (SELECT COUNT(*) FROM views)::int as "totalViews",
        (SELECT COALESCE(SUM(watch_duration), 0) FROM views)::int as "totalWatchTime",
        (SELECT COUNT(DISTINCT viewer_ip) FROM views)::int as "uniqueViewers"
    `),
    pool.query(`
      SELECT v.id, v.title, v.share_id, COUNT(vw.id)::int as views, v.duration,
        COALESCE(AVG(vw.total_percent), 0) as avg_watch_pct
      FROM videos v LEFT JOIN views vw ON v.id = vw.video_id
      GROUP BY v.id ORDER BY views DESC LIMIT 10
    `),
    pool.query(`
      SELECT vw.*, v.title as video_title
      FROM views vw JOIN videos v ON vw.video_id = v.id
      ORDER BY vw.viewed_at DESC LIMIT 20
    `),
  ]);

  res.json({
    ...totals.rows[0],
    topVideos: topVideos.rows,
    recentViews: recentViews.rows,
  });
});

// ——— Upload Signature (Cloudinary) ———
app.get('/api/upload-sig', (req, res) => {
  if (!requireAdmin(req, res)) return;

  const url = process.env.CLOUDINARY_URL;
  if (!url) return res.status(500).json({ error: 'CLOUDINARY_URL not configured' });

  const match = url.match(/cloudinary:\/\/(\d+):([^@]+)@(.+)/);
  if (!match) return res.status(500).json({ error: 'Invalid CLOUDINARY_URL format' });

  const [, apiKey, apiSecret, cloudName] = match;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'screencap';

  const signature = crypto
    .createHash('sha1')
    .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex');

  res.json({ timestamp, signature, apiKey, cloudName, folder });
});

// ——— Folders ———
app.get('/api/folders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rows } = await pool.query('SELECT name FROM folders ORDER BY name');
  res.json(rows.map(f => f.name));
});

app.post('/api/folders', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const name = String(req.body.name || '').trim().slice(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '');
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    await pool.query('INSERT INTO folders (name) VALUES ($1)', [name]);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Already exists' });
  }
});

app.delete('/api/folders/:name', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (req.params.name === 'all') return res.status(400).json({ error: 'Cannot delete default folder' });
  await pool.query("UPDATE videos SET folder = 'all' WHERE folder = $1", [req.params.name]);
  await pool.query('DELETE FROM folders WHERE name = $1', [req.params.name]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════
// ——— AI Endpoints (Server-side, powered by Groq) ———
// ═══════════════════════════════════════════════════

function getGroqKey() {
  return process.env.GROQ_API_KEY;
}

// POST /api/ai/transcribe — accepts video blob, returns transcript
app.post('/api/ai/transcribe', express.raw({ type: ['video/*', 'audio/*', 'application/octet-stream'], limit: '100mb' }), async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const groqKey = getGroqKey();
  if (!groqKey) return res.status(503).json({ error: 'GROQ_API_KEY not configured' });

  if (!req.body || req.body.length === 0) {
    return res.status(400).json({ error: 'No audio/video data received' });
  }

  try {
    // Build multipart form data manually for Groq Whisper
    const boundary = '----CapsuleBoundary' + crypto.randomBytes(8).toString('hex');
    const model = 'whisper-large-v3';

    const parts = [];

    // model field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${model}\r\n`
    );

    // response_format field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `text\r\n`
    );

    // file field
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="recording.webm"\r\n` +
      `Content-Type: video/webm\r\n\r\n`
    );

    const ending = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(parts.join('')),
      req.body,
      Buffer.from(ending),
    ]);

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq transcription failed (${groqRes.status})`);
    }

    const transcript = await groqRes.text();
    res.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/generate — generate title + description from transcript
app.post('/api/ai/generate', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const groqKey = getGroqKey();
  if (!groqKey) return res.status(503).json({ error: 'GROQ_API_KEY not configured' });

  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: 'transcript required' });

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You generate metadata for screen recordings based on their transcript.

Return ONLY valid JSON with exactly these fields:
{
  "title": "Short, descriptive title (max 60 chars)",
  "description": "2-3 sentence description suitable for social media or a video caption. Professional but engaging."
}

Rules:
- Title should be specific and clear, not generic
- Description should summarize what the video covers and who would find it useful
- Keep it professional and concise
- Return raw JSON only, no markdown code blocks`
          },
          {
            role: 'user',
            content: `Here is the transcript of a screen recording:\n\n${String(transcript).slice(0, 3000)}`
          }
        ],
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq generation failed (${groqRes.status})`);
    }

    const data = await groqRes.json();
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const clean = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(clean);
      res.json({ title: parsed.title || '', description: parsed.description || '' });
    } catch {
      res.json({ title: '', description: content });
    }
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/script — generate a teleprompter script (streaming)
app.post('/api/ai/script', async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const groqKey = getGroqKey();
  if (!groqKey) return res.status(503).json({ error: 'GROQ_API_KEY not configured' });

  const { prompt, existingScript } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const systemPrompt = `You are a professional video script writer. Write scripts meant to be read aloud as a teleprompter for screen recordings and video presentations.

Rules:
- Write in a natural, conversational tone — like talking to a colleague
- Use short sentences. Break ideas into digestible chunks.
- Include [PAUSE] markers where the speaker should take a breath
- Start with a strong hook — no "Hey guys" or "Welcome to my video"
- End with a clear call to action or summary
- Don't include stage directions, timestamps, or formatting — just the spoken words
- Aim for 150-500 words depending on topic
- If there's an existing script, improve/expand it based on the prompt`;

  const userMsg = existingScript
    ? `Here's my current script:\n\n${existingScript}\n\nUpdate based on: ${prompt}`
    : `Write a video script for: ${prompt}`;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMsg },
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Script generation failed (${groqRes.status})`);
    }

    // Stream the response through to the client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = groqRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.end();
  } catch (err) {
    console.error('Script error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// ——— Share Page (public) ———
app.get('/s/:shareId', async (req, res) => { await handleShare(req, res); });
app.post('/s/:shareId', express.urlencoded({ extended: false }), async (req, res) => { await handleShare(req, res); });

async function handleShare(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM videos WHERE share_id = $1 AND is_shared = 1',
    [req.params.shareId]
  );
  const video = rows[0];

  if (!video) return res.status(404).send(getSharePage(null));

  if (video.share_expires && new Date(video.share_expires) < new Date()) {
    return res.status(410).send(getSharePage(null, 'This link has expired.'));
  }

  if (video.share_password) {
    const pw = req.method === 'POST' ? req.body?.pw : null;
    if (!pw || !verifyPassword(pw, video.share_password)) {
      return res.send(getPasswordPage(req.params.shareId));
    }
  }

  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "media-src 'self' https://*.cloudinary.com; connect-src 'self'; img-src 'self' data:;"
  );
  res.send(getSharePage(video));
}

function getSharePage(video, errorMsg) {
  if (!video) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title>
    <style>body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .box{text-align:center;padding:40px;}.box h1{font-size:48px;margin-bottom:8px;}.box p{color:#888;font-size:16px;}</style></head>
    <body><div class="box"><h1>404</h1><p>${errorMsg || "This video doesn't exist or the link is no longer active."}</p></div></body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(video.title)} — Capsule</title>
  <meta property="og:title" content="${escapeHtml(video.title)}">
  <meta property="og:type" content="video.other">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;color:#e8e8e8;min-height:100vh;}
    .header{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid #2a2a2a;background:#1a1a1a;}
    .logo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;}
    .logo-mark{width:28px;height:28px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);border-radius:6px;display:flex;align-items:center;justify-content:center;}
    .logo-mark svg{width:16px;height:16px;fill:white;}
    .container{max-width:900px;margin:0 auto;padding:32px;}
    .player{border-radius:12px;overflow:hidden;background:#000;border:1px solid #2a2a2a;}
    .player video{width:100%;display:block;}
    .info{padding:20px 0;}
    .info h1{font-size:22px;font-weight:700;margin-bottom:8px;}
    .meta{display:flex;gap:16px;color:#888;font-size:14px;}
    .cta{margin-top:24px;padding:20px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;text-align:center;}
    .cta p{color:#888;font-size:14px;margin-bottom:12px;}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;background:#34d399;color:#000;text-decoration:none;}
    .btn:hover{background:#4ade9f;}
    .viewer-prompt{max-width:400px;margin:0 auto;padding:40px 20px;text-align:center;}
    .viewer-prompt input{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;color:#e8e8e8;font-size:14px;margin:12px 0;outline:none;}
    .viewer-prompt input:focus{border-color:#8b5cf6;}
    .btn-start{background:#8b5cf6;color:white;width:100%;justify-content:center;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;}
    .btn-start:hover{background:#a78bfa;}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-mark"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg></div>
      Capsule
    </div>
  </div>
  <div class="container">
    <div class="viewer-prompt" id="namePrompt">
      <h2 style="margin-bottom:4px;">${escapeHtml(video.title)}</h2>
      <p style="color:#888;font-size:14px;margin-bottom:20px;">Enter your name to start watching</p>
      <input type="text" id="viewerName" placeholder="Your name (optional)" autofocus
        onkeydown="if(event.key==='Enter')startWatching()" />
      <button class="btn-start" onclick="startWatching()" style="margin-top:8px;">
        &#9654; Watch Video
      </button>
    </div>
    <div id="playerSection" style="display:none;">
      <div class="player">
        <video id="video" controls preload="metadata">
          <source src="/api/videos/${video.id}/stream" type="video/webm">
        </video>
      </div>
      <div class="info">
        <h1>${escapeHtml(video.title)}</h1>
        <div class="meta">
          <span>${formatDuration(video.duration)}</span>
          <span>${new Date(video.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      ${video.allow_download ? `
      <div class="cta">
        <p>Want a copy?</p>
        <a href="/api/videos/${video.id}/stream" download="${escapeHtml(video.title)}.webm" class="btn">
          Download Video
        </a>
      </div>` : ''}
    </div>
  </div>
  <script>
    const VIDEO_ID = '${video.id}';
    const VIDEO_DURATION = ${video.duration};
    let viewRecorded = false;

    function startWatching() {
      const name = document.getElementById('viewerName').value.trim() || 'Anonymous';
      document.getElementById('namePrompt').style.display = 'none';
      document.getElementById('playerSection').style.display = '';

      fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: VIDEO_ID, viewer_name: name, watch_duration: 0, total_percent: 0 })
      });
      viewRecorded = true;

      const video = document.getElementById('video');
      video.play().catch(() => {});

      setInterval(() => {
        if (video.paused || !viewRecorded) return;
        const ct = Math.floor(video.currentTime);
        const pct = VIDEO_DURATION > 0 ? Math.min(Math.round((video.currentTime / VIDEO_DURATION) * 100), 100) : 0;
        fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: VIDEO_ID, viewer_name: document.getElementById('viewerName').value.trim() || 'Anonymous', watch_duration: ct, total_percent: pct })
        });
      }, 30000);

      video.addEventListener('ended', () => {
        fetch('/api/views', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: VIDEO_ID, viewer_name: document.getElementById('viewerName').value.trim() || 'Anonymous', watch_duration: VIDEO_DURATION, total_percent: 100 })
        });
      });
    }
  </script>
</body>
</html>`;
}

function getPasswordPage(shareId) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Password Required</title>
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .box{text-align:center;padding:40px;max-width:360px;width:100%;}.box h2{margin-bottom:8px;}.box p{color:#888;font-size:14px;margin-bottom:20px;}
  input{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;color:#e8e8e8;font-size:14px;margin-bottom:12px;outline:none;}
  input:focus{border-color:#8b5cf6;}
  button{width:100%;padding:10px;background:#8b5cf6;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;}
  button:hover{background:#a78bfa;}</style></head>
  <body><div class="box"><h2>Password Required</h2><p>This video is password protected.</p>
  <form method="POST" action="/s/${escapeHtml(shareId)}">
  <input type="password" name="pw" placeholder="Enter password" autofocus />
  <button type="submit">Watch Video</button>
  </form></div></body></html>`;
}

// ——— Start Server ———
async function start() {
  try {
    await initDb();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n  Capsule server running at http://localhost:${PORT}`);
      console.log(`  Share links: http://localhost:${PORT}/s/{id}`);
      console.log(`  Health check: http://localhost:${PORT}/health\n`);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
