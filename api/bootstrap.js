import { loadData, sendJson } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });

  try {
    const data = await loadData();
    return sendJson(res, 200, {
      ok: true,
      tasks: data.tasks || [],
      opTasks: data.opTasks || [],
      webhookConfig: data.webhookConfig || { url: '', events: { andamento: true, concluida: true, finalizada: true } },
      plannerConfig: data.plannerConfig || { note: '' },
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error?.message || 'internal error' });
  }
}

