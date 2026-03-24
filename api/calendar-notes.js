import { loadData, parseBody, saveData, sendJson } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    const body = parseBody(req);
    const id = Number(body.id || 0);
    const data = await loadData();
    data.calendarNotes = Array.isArray(data.calendarNotes) ? data.calendarNotes : [];

    if (req.method === 'POST') {
      if (!id) return sendJson(res, 422, { ok: false, error: 'id invalido' });
      const idx = data.calendarNotes.findIndex((n) => Number(n.id) === id);
      if (idx >= 0) data.calendarNotes[idx] = { ...data.calendarNotes[idx], ...body };
      else data.calendarNotes.push(body);
      await saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!id) return sendJson(res, 422, { ok: false, error: 'id invalido' });
      data.calendarNotes = data.calendarNotes.filter((n) => Number(n.id) !== id);
      await saveData(data);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error?.message || 'internal error' });
  }
}

