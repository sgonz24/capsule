const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3847;

// Ensure uploads directory
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`)
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// Database
const db = new Database(path.join(__dirname, 'screencap.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    share_id TEXT UNIQUE,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    duration INTEGER DEFAULT 0,
    folder TEXT DEFAULT 'all',
    created_at TEXT DEFAULT (datetime('now')),
    file_size INTEGER DEFAULT 0,
    is_shared INTEGER DEFAULT 0,
    share_password TEXT,
    share_expires TEXT,
    allow_download INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    viewer_ip TEXT,
    viewer_name TEXT,
    user_agent TEXT,
    watch_duration INTEGER DEFAULT 0,
    total_percent REAL DEFAULT 0,
    viewed_at TEXT DEFAULT (datetime('now')),
    city TEXT,
    country TEXT,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );
  CREATE TABLE IF NOT EXISTS folders (
    name TEXT PRIMARY KEY
  );
  CREATE INDEX IF NOT EXISTS idx_views_video ON views(video_id);
  CREATE INDEX IF NOT EXISTS idx_share_id ON videos(share_id);
`);

const hasAll = db.prepare("SELECT name FROM folders WHERE name = 'all'").get();
if (!hasAll) db.prepare("INSERT INTO folders (name) VALUES ('all')").run();

app.use(express.json());
app.use(express.static(__dirname));

// ——— API: Videos ———

app.post('/api/videos', upload.single('video'), (req, res) => {
  const { title, duration, folder } = req.body;
  const id = uuidv4().split('-')[0] + uuidv4().split('-')[1];
  const shareId = generateShareId();

  db.prepare(`
    INSERT INTO videos (id, share_id, title, filename, duration, folder, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, shareId, title || 'Untitled', req.file.filename, parseInt(duration) || 0, folder || 'all', req.file.size);

  res.json({ id, shareId, title });
});

app.get('/api/videos', (req, res) => {
  const videos = db.prepare(`
    SELECT v.*, COUNT(vw.id) as view_count,
    COALESCE(SUM(vw.watch_duration), 0) as total_watch_time
    FROM videos v
    LEFT JOIN views vw ON v.id = vw.video_id
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `).all();
  res.json(videos);
});

app.get('/api/videos/:id', (req, res) => {
  const video = db.prepare(`
    SELECT v.*, COUNT(vw.id) as view_count
    FROM videos v
    LEFT JOIN views vw ON v.id = vw.video_id
    WHERE v.id = ?
    GROUP BY v.id
  `).get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });
  res.json(video);
});

app.patch('/api/videos/:id', (req, res) => {
  const { title, folder, is_shared, share_password, share_expires, allow_download } = req.body;
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE videos SET
      title = COALESCE(?, title),
      folder = COALESCE(?, folder),
      is_shared = COALESCE(?, is_shared),
      share_password = COALESCE(?, share_password),
      share_expires = COALESCE(?, share_expires),
      allow_download = COALESCE(?, allow_download)
    WHERE id = ?
  `).run(title, folder, is_shared, share_password, share_expires, allow_download, req.params.id);

  res.json({ ok: true });
});

app.delete('/api/videos/:id', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Not found' });

  const filepath = path.join(UPLOADS_DIR, video.filename);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

  db.prepare('DELETE FROM views WHERE video_id = ?').run(req.params.id);
  db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/videos/:id/stream', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).send('Not found');

  const filepath = path.join(UPLOADS_DIR, video.filename);
  if (!fs.existsSync(filepath)) return res.status(404).send('File missing');

  const stat = fs.statSync(filepath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/webm',
    });
    fs.createReadStream(filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/webm' });
    fs.createReadStream(filepath).pipe(res);
  }
});

// ——— API: Views ———

app.get('/api/videos/:id/views', (req, res) => {
  const views = db.prepare('SELECT * FROM views WHERE video_id = ? ORDER BY viewed_at DESC').all(req.params.id);
  res.json(views);
});

app.post('/api/views', (req, res) => {
  const { video_id, viewer_name, watch_duration, total_percent } = req.body;
  const viewerIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'];

  db.prepare(`
    INSERT INTO views (video_id, viewer_ip, viewer_name, user_agent, watch_duration, total_percent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(video_id, viewerIp, viewer_name || 'Anonymous', userAgent, watch_duration || 0, total_percent || 0);

  res.json({ ok: true });
});

app.patch('/api/views/:id', (req, res) => {
  const { watch_duration, total_percent } = req.body;
  db.prepare('UPDATE views SET watch_duration = ?, total_percent = ? WHERE id = ?')
    .run(watch_duration, total_percent, req.params.id);
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  const totalVideos = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
  const totalViews = db.prepare('SELECT COUNT(*) as count FROM views').get().count;
  const totalWatchTime = db.prepare('SELECT COALESCE(SUM(watch_duration), 0) as total FROM views').get().total;
  const uniqueViewers = db.prepare('SELECT COUNT(DISTINCT viewer_ip) as count FROM views').get().count;

  const topVideos = db.prepare(`
    SELECT v.id, v.title, v.share_id, COUNT(vw.id) as views, v.duration,
    COALESCE(AVG(vw.total_percent), 0) as avg_watch_pct
    FROM videos v
    LEFT JOIN views vw ON v.id = vw.video_id
    GROUP BY v.id
    ORDER BY views DESC
    LIMIT 10
  `).all();

  const recentViews = db.prepare(`
    SELECT vw.*, v.title as video_title
    FROM views vw
    JOIN videos v ON vw.video_id = v.id
    ORDER BY vw.viewed_at DESC
    LIMIT 20
  `).all();

  res.json({ totalVideos, totalViews, totalWatchTime, uniqueViewers, topVideos, recentViews });
});

// ——— API: Folders ———

app.get('/api/folders', (req, res) => {
  const folders = db.prepare('SELECT name FROM folders ORDER BY rowid').all();
  res.json(folders.map(f => f.name));
});

app.post('/api/folders', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    db.prepare('INSERT INTO folders (name) VALUES (?)').run(name.trim());
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: 'Already exists' });
  }
});

app.delete('/api/folders/:name', (req, res) => {
  if (req.params.name === 'all') return res.status(400).json({ error: 'Cannot delete default folder' });
  db.prepare("UPDATE videos SET folder = 'all' WHERE folder = ?").run(req.params.name);
  db.prepare('DELETE FROM folders WHERE name = ?').run(req.params.name);
  res.json({ ok: true });
});

// ——— Share Page ———

app.get('/s/:shareId', (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE share_id = ? AND is_shared = 1').get(req.params.shareId);
  if (!video) return res.status(404).send(getSharePage(null));

  if (video.share_expires && new Date(video.share_expires) < new Date()) {
    return res.status(410).send(getSharePage(null, 'This link has expired.'));
  }

  if (video.share_password) {
    const pw = req.query.pw;
    if (pw !== video.share_password) {
      return res.send(getPasswordPage(req.params.shareId));
    }
  }

  res.send(getSharePage(video));
});

function generateShareId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function getSharePage(video, errorMsg) {
  if (!video) {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title>
    <style>body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .box{text-align:center;padding:40px;}.box h1{font-size:48px;margin-bottom:8px;}.box p{color:#888;font-size:16px;}</style></head>
    <body><div class="box"><h1>404</h1><p>${errorMsg || 'This video doesn\'t exist or the link is no longer active.'}</p></div></body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(video.title)} — ScreenCap</title>
  <meta property="og:title" content="${escapeHtml(video.title)}">
  <meta property="og:type" content="video.other">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;color:#e8e8e8;min-height:100vh;}
    .header{display:flex;align-items:center;justify-content:space-between;padding:16px 32px;border-bottom:1px solid #2a2a2a;background:#1a1a1a;}
    .logo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;}
    .logo-box{width:28px;height:28px;background:#4f8cff;border-radius:6px;display:flex;align-items:center;justify-content:center;}
    .logo-box svg{width:16px;height:16px;fill:white;}
    .container{max-width:900px;margin:0 auto;padding:32px;}
    .player{border-radius:12px;overflow:hidden;background:#000;border:1px solid #2a2a2a;}
    .player video{width:100%;display:block;}
    .info{padding:20px 0;}
    .info h1{font-size:22px;font-weight:700;margin-bottom:8px;}
    .meta{display:flex;gap:16px;color:#888;font-size:14px;}
    .meta span{display:flex;align-items:center;gap:4px;}
    .cta{margin-top:24px;padding:20px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;text-align:center;}
    .cta p{color:#888;font-size:14px;margin-bottom:12px;}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:8px;border:none;font-size:14px;font-weight:600;cursor:pointer;background:#34d399;color:#000;transition:background .15s;text-decoration:none;}
    .btn:hover{background:#4ade9f;}
    .viewer-prompt{max-width:400px;margin:0 auto;padding:40px 20px;text-align:center;}
    .viewer-prompt input{width:100%;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;color:#e8e8e8;font-size:14px;margin:12px 0;outline:none;}
    .viewer-prompt input:focus{border-color:#4f8cff;}
    .btn-start{background:#4f8cff;color:white;width:100%;justify-content:center;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;}
    .btn-start:hover{background:#6ba0ff;}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-box"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg></div>
      ScreenCap
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

      // Record initial view
      fetch('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: VIDEO_ID, viewer_name: name, watch_duration: 0, total_percent: 0 })
      });
      viewRecorded = true;

      const video = document.getElementById('video');
      video.play().catch(() => {});

      // Heartbeat every 30s
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

      // Record final on video end
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
  input:focus{border-color:#4f8cff;}
  button{width:100%;padding:10px;background:#4f8cff;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;}
  button:hover{background:#6ba0ff;}</style></head>
  <body><div class="box"><h2>Password Required</h2><p>This video is password protected.</p>
  <form method="GET" action="/s/${shareId}">
  <input type="password" name="pw" placeholder="Enter password" autofocus />
  <button type="submit">Watch Video</button>
  </form></div></body></html>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

app.listen(PORT, () => {
  console.log(`\n  ScreenCap server running at http://localhost:${PORT}\n`);
  console.log(`  Share links: http://localhost:${PORT}/s/{id}`);
  console.log(`  For public sharing: npx localtunnel --port ${PORT}\n`);
});
