import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, HttpError, sendJson } from './api.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, url, publicDir) {
  const pathname = decodeURIComponent(url.pathname);
  const target = resolve(join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (target !== publicDir && !target.startsWith(publicDir + sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'EISDIR') throw err;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // clients hors navigateur (curl, tests)
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function createServer({ db, publicDir = DEFAULT_PUBLIC_DIR, now } = {}) {
  const api = createApi(db, { now });
  const root = resolve(publicDir);

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        // Protection CSRF : une autre page web ouverte dans le navigateur ne doit pas pouvoir modifier la base.
        if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) {
          throw new HttpError(403, 'Requête refusée : origine non autorisée');
        }
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
      await serveStatic(req, res, url, root);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        return sendJson(res, err.status, { error: err.message, ...(err.details && { details: err.details }) });
      }
      if (err instanceof URIError) return sendJson(res, 400, { error: 'URL invalide' });
      console.error(err);
      sendJson(res, 500, { error: 'Erreur interne du serveur' });
    }
  });
}
