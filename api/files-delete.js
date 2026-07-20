// api/files-delete.js
// Deletes a file from the repo (GitHub Contents API).
// Body: { path: "example.html" }
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

  const { path } = req.body || {};
  if (!path) return res.status(400).json({ error: 'المسار مطلوب' });

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'legista-admin-dashboard'
  };

  try {
    const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
    if (!existing.ok) {
      return res.status(404).json({ error: 'الملف غير موجود' });
    }
    const existingData = await existing.json();

    const delRes = await fetch(apiUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `حذف ${path} من لوحة التحكم`,
        sha: existingData.sha,
        branch
      })
    });
    const delData = await delRes.json();
    if (!delRes.ok) {
      return res.status(delRes.status).json({ error: delData.message || 'خطأ من GitHub' });
    }
    return res.status(200).json({ success: true, path });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
