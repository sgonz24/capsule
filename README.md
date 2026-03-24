# Capsule

Open-source Loom alternative. Record your screen, share a link, track who watched.

**No limits. No uploads to third parties. Self-hosted.**

## Features

- **Screen recording** with mic, system audio, and webcam overlay
- **Shareable links** with password protection and download controls
- **View tracking** — see who watched, how long, and what % they completed
- **Teleprompter** — write a script, it scrolls while you record
- **AI script writer** — connect a free Groq key or use smart templates
- **Slides & attachments** — organize talking points with clickable links
- **Video library** with folders, sorting, hover previews, and inline rename
- **Analytics dashboard** — total views, unique viewers, top videos, watch time

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS (single file, no build) |
| Backend | Vercel Serverless Functions |
| Database | Neon Postgres |
| Video Storage | Cloudinary |
| Hosting | Vercel |

## Deploy Your Own

### 1. Clone

```bash
git clone https://github.com/sgonz24/capsule.git
cd capsule
npm install
```

### 2. Set up services (all free tier)

- **Neon Postgres** — [console.neon.tech](https://console.neon.tech) → New Project → copy connection string
- **Cloudinary** — [cloudinary.com](https://cloudinary.com) → Dashboard → copy `CLOUDINARY_URL`

### 3. Deploy to Vercel

```bash
vercel link --yes
vercel env add DATABASE_URL production    # paste Neon connection string
vercel env add CLOUDINARY_URL production  # paste cloudinary://key:secret@cloud
vercel deploy --prod --yes
```

### 4. Initialize database

Hit `POST /api/setup` once after first deploy, or run:

```bash
curl -X POST https://your-app.vercel.app/api/setup
```

### 5. Optional: AI script writer

- Get a free key at [console.groq.com/keys](https://console.groq.com/keys)
- In the app, click the gear icon next to "Write Script" and paste your key
- Stored in your browser only — never touches the server

## Local Development

```bash
npm install express multer better-sqlite3 uuid
npm start
# Runs at http://localhost:3847 with SQLite (no cloud deps needed)
```

## License

MIT
