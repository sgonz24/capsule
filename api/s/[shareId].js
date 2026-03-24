const { getDb } = require('../_db');

module.exports = async function handler(req, res) {
  const sql = getDb();
  const { shareId } = req.query;

  const rows = await sql`SELECT * FROM videos WHERE share_id = ${shareId} AND is_shared = 1`;
  const video = rows[0];

  if (!video) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send(errorPage('This video doesn\'t exist or the link is no longer active.'));
  }

  if (video.share_expires && new Date(video.share_expires) < new Date()) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(410).send(errorPage('This link has expired.'));
  }

  if (video.share_password) {
    const pw = req.query.pw;
    if (pw !== video.share_password) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(passwordPage(shareId));
    }
  }

  res.setHeader('Content-Type', 'text/html');
  res.send(sharePage(video));
};

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDur(secs) {
  return `${Math.floor(secs/60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found — Capsule</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>body{font-family:'Inter',sans-serif;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;-webkit-font-smoothing:antialiased;}
.box{text-align:center;padding:40px;}.box h1{font-size:56px;font-weight:700;margin-bottom:8px;letter-spacing:-2px;background:linear-gradient(to right,#fff,rgba(255,255,255,.4));-webkit-background-clip:text;-webkit-text-fill-color:transparent;}.box p{color:rgba(255,255,255,.45);font-size:15px;}</style></head>
<body><div class="box"><h1>404</h1><p>${msg}</p></div></body></html>`;
}

function passwordPage(shareId) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Password Required — Capsule</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Inter',sans-serif;background:#09090b;color:#fafafa;display:flex;align-items:center;justify-content:center;min-height:100vh;-webkit-font-smoothing:antialiased;}
.box{text-align:center;padding:40px;max-width:360px;width:100%;}h2{margin-bottom:8px;font-weight:700;letter-spacing:-.3px;}p{color:rgba(255,255,255,.45);font-size:14px;margin-bottom:20px;}
input{width:100%;padding:11px 16px;background:#18181b;border:1px solid rgba(255,255,255,.06);border-radius:9999px;color:#fafafa;font-size:14px;margin-bottom:12px;outline:none;font-family:inherit;}
input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.15);}
button{width:100%;padding:11px;background:#8b5cf6;color:white;border:none;border-radius:9999px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .2s;}
button:hover{background:#a78bfa;}</style></head>
<body><div class="box"><h2>Password Required</h2><p>This video is password protected.</p>
<form method="GET"><input type="password" name="pw" placeholder="Enter password" autofocus/>
<button type="submit">Watch Video</button></form></div></body></html>`;
}

function sharePage(video) {
  const streamUrl = video.blob_url;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(video.title)} — Capsule</title>
<meta property="og:title" content="${esc(video.title)}">
<meta property="og:type" content="video.other">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:#09090b;color:#fafafa;min-height:100vh;-webkit-font-smoothing:antialiased;}
.header{display:flex;align-items:center;padding:14px 28px;border-bottom:1px solid rgba(255,255,255,.06);background:rgba(9,9,11,.8);backdrop-filter:blur(20px);}
.logo{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;letter-spacing:-.4px;}
.logo-box{width:28px;height:28px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);border-radius:7px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;}
.container{max-width:900px;margin:0 auto;padding:32px;}
.player{border-radius:16px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.06);}
.player video{width:100%;display:block;}
.info{padding:20px 0;}
.info h1{font-size:22px;font-weight:700;margin-bottom:8px;letter-spacing:-.3px;}
.meta{display:flex;gap:16px;color:rgba(255,255,255,.45);font-size:13px;font-weight:500;}
.cta{margin-top:24px;padding:24px;background:#18181b;border:1px solid rgba(255,255,255,.06);border-radius:16px;text-align:center;}
.cta p{color:rgba(255,255,255,.45);font-size:13px;margin-bottom:14px;}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 24px;border-radius:9999px;border:none;font-size:14px;font-weight:600;cursor:pointer;background:#22c55e;color:#000;text-decoration:none;font-family:inherit;transition:all .2s;}
.btn:hover{background:#4ade80;}
.prompt{max-width:400px;margin:0 auto;padding:40px 20px;text-align:center;}
.prompt input{width:100%;padding:11px 16px;background:#18181b;border:1px solid rgba(255,255,255,.06);border-radius:9999px;color:#fafafa;font-size:14px;margin:12px 0;outline:none;font-family:inherit;transition:all .2s;}
.prompt input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.15);}
.btn-start{background:#8b5cf6;color:white;width:100%;display:flex;justify-content:center;padding:13px;border:none;border-radius:9999px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s;}
.btn-start:hover{background:#a78bfa;box-shadow:0 0 24px rgba(139,92,246,.2);}
</style>
</head>
<body>
<div class="header">
  <div class="logo"><div class="logo-box">C</div>Capsule</div>
</div>
<div class="container">
  <div class="prompt" id="namePrompt">
    <h2 style="margin-bottom:4px;">${esc(video.title)}</h2>
    <p style="color:#888;font-size:14px;margin-bottom:20px;">Enter your name to start watching</p>
    <input type="text" id="viewerName" placeholder="Your name (optional)" autofocus onkeydown="if(event.key==='Enter')startWatching()"/>
    <button class="btn-start" onclick="startWatching()" style="margin-top:8px;">&#9654; Watch Video</button>
  </div>
  <div id="playerSection" style="display:none;">
    <div class="player"><video id="video" controls preload="metadata"><source src="${esc(streamUrl)}" type="video/webm"></video></div>
    <div class="info">
      <h1>${esc(video.title)}</h1>
      <div class="meta">
        <span>${fmtDur(video.duration)}</span>
        <span>${new Date(video.created_at).toLocaleDateString()}</span>
      </div>
    </div>
    ${video.allow_download ? `<div class="cta"><p>Want a copy?</p><a href="${esc(streamUrl)}" download="${esc(video.title)}.webm" class="btn">Download Video</a></div>` : ''}
  </div>
</div>
<script>
const VIDEO_ID='${video.id}',VIDEO_DURATION=${video.duration};
function startWatching(){
  const name=document.getElementById('viewerName').value.trim()||'Anonymous';
  document.getElementById('namePrompt').style.display='none';
  document.getElementById('playerSection').style.display='';
  fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({video_id:VIDEO_ID,viewer_name:name,watch_duration:0,total_percent:0})});
  document.getElementById('video').play().catch(()=>{});
  setInterval(()=>{
    const v=document.getElementById('video');
    if(v.paused)return;
    const ct=Math.floor(v.currentTime),pct=VIDEO_DURATION>0?Math.min(Math.round(v.currentTime/VIDEO_DURATION*100),100):0;
    fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({video_id:VIDEO_ID,viewer_name:name,watch_duration:ct,total_percent:pct})});
  },30000);
  document.getElementById('video').addEventListener('ended',()=>{
    fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({video_id:VIDEO_ID,viewer_name:name,watch_duration:VIDEO_DURATION,total_percent:100})});
  });
}
</script>
</body></html>`;
}
