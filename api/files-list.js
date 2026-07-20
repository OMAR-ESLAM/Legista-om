// api/files-list.js
// Lists files in the repo root (GitHub Contents API).
// Requires env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH (optional, default "main")
// Optional simple guard: header "x-admin-password" must match process.env.ADMIN_PASSWORD

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'OMAR0801';
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ error: 'إعدادات GitHub ناقصة على السيرفر (تحقق من Environment Variables في Vercel)' });
  }
  const branch = GITHUB_BRANCH || 'main';
  const path = (req.query && req.query.path) || '';

  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${branch}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'legista-admin-dashboard'
        }
      }
    );
    const data = await ghRes.json();
    if (!ghRes.ok) {
      return res.status(ghRes.status).json({ error: data.message || 'خطأ من GitHub' });
    }
    const files = (Array.isArray(data) ? data : [data]).map(f => ({
      name: f.name,
      path: f.path,
      size: f.size,
      sha: f.sha,
      type: f.type,
      download_url: f.download_url
    }));
    return res.status(200).json({ files });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
