import { loadData, parseBody, saveData, sendJson } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const body = parseBody(req);
    const id = Number(body.id || 0);
    if (!id) return sendJson(res, 422, { ok: false, error: 'id invalido' });

    const data = await loadData();
    const idx = (data.tasks || []).findIndex((t) => Number(t.id) === id);
    if (idx >= 0) data.tasks[idx] = { ...data.tasks[idx], ...body };
    else data.tasks.push(body);
    await saveData(data);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error?.message || 'internal error' });
  }
}

