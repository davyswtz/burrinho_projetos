import { loadData, parseBody, saveData, sendJson } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const data = await loadData();
    if (body.webhookConfig) data.webhookConfig = body.webhookConfig;
    if (body.plannerConfig) data.plannerConfig = body.plannerConfig;
    await saveData(data);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error?.message || 'internal error' });
  }
}

