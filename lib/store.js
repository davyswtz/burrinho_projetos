import { list, put } from '@vercel/blob';

const DATA_PATH = 'planner-data.json';

const defaultData = () => ({
  tasks: [],
  opTasks: [],
  calendarNotes: [],
  webhookConfig: { url: '', events: { andamento: true, concluida: true, finalizada: true } },
  plannerConfig: { note: '' },
});

export function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(payload));
}

export function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export async function loadData() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return defaultData();
  const found = await list({ prefix: DATA_PATH, limit: 1, token: process.env.BLOB_READ_WRITE_TOKEN });
  const blob = (found.blobs || []).find((b) => b.pathname === DATA_PATH) || (found.blobs || [])[0];
  if (!blob) return defaultData();
  try {
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) return defaultData();
    const payload = await response.json();
    return { ...defaultData(), ...(payload || {}) };
  } catch {
    return defaultData();
  }
}

export async function saveData(data) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(DATA_PATH, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}
