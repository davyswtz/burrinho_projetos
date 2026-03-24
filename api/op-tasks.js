import { loadData, parseBody, saveData, sendJson } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const body = parseBody(req);
    const id = Number(body.id || 0);
    const data = await loadData();
    data.opTasks = Array.isArray(data.opTasks) ? data.opTasks : [];

    if (req.method === 'POST') {
      if (!id) return sendJson(res, 422, { ok: false, error: 'id invalido' });
      const idx = data.opTasks.findIndex((t) => Number(t.id) === id);
      if (idx >= 0) data.opTasks[idx] = { ...data.opTasks[idx], ...body };
      else data.opTasks.push(body);
      await saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!id) return sendJson(res, 422, { ok: false, error: 'id invalido' });
      const cascade = Boolean(body.cascade);
      data.opTasks = cascade
        ? data.opTasks.filter((t) => Number(t.id) !== id && Number(t.parentTaskId) !== id)
        : data.opTasks.filter((t) => Number(t.id) !== id);
      await saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error?.message || 'internal error' });
  }
}

