const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Parse CLOUDINARY_URL: cloudinary://api_key:api_secret@cloud_name
  const url = process.env.CLOUDINARY_URL;
  if (!url) return res.status(500).json({ error: 'CLOUDINARY_URL not configured' });

  const match = url.match(/cloudinary:\/\/(\d+):([^@]+)@(.+)/);
  if (!match) return res.status(500).json({ error: 'Invalid CLOUDINARY_URL format' });

  const [, apiKey, apiSecret, cloudName] = match;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'screencap';

  // Generate signature
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign + apiSecret)
    .digest('hex');

  res.json({
    timestamp,
    signature,
    apiKey,
    cloudName,
    folder,
  });
};
