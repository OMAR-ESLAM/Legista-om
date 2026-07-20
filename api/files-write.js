// api/files-write.js
// Creates or updates a file in the repo (GitHub Contents API).
// Body: { path: "example.html", contentBase64: "...", message: "commit message" }
// Requires env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH (optional)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'OMAR0801';
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res.status(500).json({ error: 'إعدادات GitHub ناقصة على السيرفر' });
  }
  const branch = GITHUB_BRANCH || 'main';

  const { path, contentBase64, message } = req.body || {};
  if (!path || !contentBase64) {
    return res.status(400).json({ error: 'المسار والمحتوى مطلوبين' });
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'legista-admin-dashboard'
  };

  try {
    // Check if file already exists to get its sha (needed for updates)
    let sha;
    const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
    if (existing.ok) {
      const existingData = await existing.json();
      sha = existingData.sha;
    }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message || `تحديث ${path} من لوحة التحكم`,
        content: contentBase64,
        branch,
        ...(sha ? { sha } : {})
      })
    });
    const putData = await putRes.json();
    if (!putRes.ok) {
      return res.status(putRes.status).json({ error: putData.message || 'خطأ من GitHub' });
    }
    return res.status(200).json({ success: true, path, updated: !!sha });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
