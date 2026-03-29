const crypto = require('crypto');
const { requireAdmin, securityHeaders } = require('./_db');

module.exports = async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!requireAdmin(req, res)) return;

  const url = process.env.CLOUDINARY_URL;
  if (!url) return res.status(500).json({ error: 'CLOUDINARY_URL not configured' });

  const match = url.match(/cloudinary:\/\/(\d+):([^@]+)@(.+)/);
  if (!match) return res.status(500).json({ error: 'Invalid CLOUDINARY_URL format' });

  const [, apiKey, apiSecret, cloudName] = match;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'screencap';

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
