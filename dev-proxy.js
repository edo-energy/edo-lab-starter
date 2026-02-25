#!/usr/bin/env node
/**
 * dev-proxy.js — Edo Lab Starter: local development proxy
 *
 * Zero-dependency local server (Node.js built-ins only) that:
 *   1. Handles the B2C OAuth2 PKCE auth flow so you never paste tokens manually
 *   2. Caches your token to disk — survives proxy restarts
 *   3. Proxies /api/edo/* → Edo API, forwarding your Bearer token
 *   4. Serves static files from this directory
 *
 * Usage:
 *   node dev-proxy.js
 *   Open http://localhost:3001 → click "Authorize with Edo" → done
 */

'use strict';

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const crypto = require('crypto');

// ── Load .env.local ───────────────────────────────────────────────────────────

try {
  fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8')
    .split('\n')
    .forEach(line => {
      const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined)
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
} catch { /* .env.local is optional */ }

// ── Config ────────────────────────────────────────────────────────────────────

const PORT         = Number(process.env.PORT ?? 3001);
const EDO_API_BASE = (process.env.EDO_API_BASE ?? 'https://services-internal.apis.edoenergy.com').replace(/\/$/, '');

// ── B2C / OAuth2 PKCE ─────────────────────────────────────────────────────────

const CLIENT_ID    = '66ca0383-bf0c-4dc8-9d57-c852c06a9413';
const TENANT_ID    = '48d03f3f-62a3-401f-b4a2-2514758215ac';
const POLICY       = 'B2C_1A_MULTITENANT';
const B2C_HOST     = 'login.edoenergy.com';
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES       = [
  'https://edoapps.onmicrosoft.com/services/point.read',
  'https://edoapps.onmicrosoft.com/services/timeseries.read',
  'https://edoapps.onmicrosoft.com/services/bill.read',
  'https://edoapps.onmicrosoft.com/services/building.read',
];

// ── Token cache ───────────────────────────────────────────────────────────────

let _token       = null;
let _tokenExpiry = 0;
const _pkce      = new Map();  // state → verifier; cleaned up after use
const CACHE_FILE = path.join(__dirname, '.token-cache.json');

// Restore a previously cached token at startup
try {
  const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  if (c.access_token && c.expires_on * 1000 > Date.now() + 60_000) {
    _token       = c.access_token;
    _tokenExpiry = c.expires_on * 1000;
  }
} catch { /* no cache */ }

function tokenValid() {
  return !!(_token && _tokenExpiry > Date.now() + 60_000);
}

function persistToken(result) {
  _token       = result.access_token;
  _tokenExpiry = Date.now() + result.expires_in * 1000;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      access_token: _token,
      expires_on:   Math.floor(_tokenExpiry / 1000),
    }));
  } catch { /* best effort */ }
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generatePKCE() {
  const verifier  = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// ── Token exchange ────────────────────────────────────────────────────────────

function exchangeCode(code, verifier) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      client_id:     CLIENT_ID,
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: verifier,
      scope:         SCOPES.join(' '),
    }).toString();

    const req = https.request({
      hostname: B2C_HOST,
      path:     `/${TENANT_ID}/${POLICY}/oauth2/v2.0/token`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try   { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Unexpected response: ${data.slice(0, 200)}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// ── Request handler ───────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  // CORS — allow any local origin during dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url);

  // ── OAuth callback — B2C redirects back to root with ?code= ─────────────────
  // Redirect URI is http://localhost:PORT (no path), matching the registered URIs
  if (parsed.pathname === '/' && parsed.search?.includes('code=')) {
    const params   = new URLSearchParams(parsed.search ?? '');
    const code     = params.get('code');
    const state    = params.get('state');
    const errMsg   = params.get('error_description') ?? params.get('error');

    const page = (heading, detail, isError) => `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: ${isError ? '#1a0808' : '#07130d'}; color: ${isError ? '#f87171' : '#4ade80'};
         gap: 12px; text-align: center; padding: 24px; }
  h2 { margin: 0; font-size: 22px; }
  p  { margin: 0; opacity: .6; font-size: 13px; }
</style></head><body>
  <h2>${heading}</h2><p>${detail}</p>
  <script>
    window.opener?.postMessage('${isError ? 'edo_auth_error' : 'edo_auth_ok'}', '*');
    setTimeout(() => window.close(), 1200);
  </script>
</body></html>`;

    if (errMsg) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page('Authorization failed', errMsg, true));
      return;
    }

    const verifier = _pkce.get(state);
    _pkce.delete(state);

    if (!code || !verifier) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(page('Invalid callback', 'Missing code or state — please try again.', true));
      return;
    }

    try {
      const result = await exchangeCode(code, verifier);
      if (result.access_token) {
        persistToken(result);
        console.log('[auth] Token acquired and cached.');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Authorized!', 'This window will close automatically.', false));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(page('Auth failed', result.error_description ?? result.error ?? 'Unknown error', true));
      }
    } catch (err) {
      console.error('[auth]', err.message);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page('Token exchange failed', err.message, true));
    }
    return;
  }

  // ── /oauth/start — kick off PKCE auth flow ──────────────────────────────────
  if (parsed.pathname === '/oauth/start') {
    const state = b64url(crypto.randomBytes(16));
    const { verifier, challenge } = generatePKCE();
    _pkce.set(state, verifier);

    const authUrl = `https://${B2C_HOST}/${TENANT_ID}/${POLICY}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id:             CLIENT_ID,
        response_type:         'code',
        redirect_uri:          REDIRECT_URI,
        response_mode:         'query',
        scope:                 SCOPES.join(' '),
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();

    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // ── /api/dev-auth/status — edo.js polls this after clicking Authorize ────────
  if (parsed.pathname === '/api/dev-auth/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(
      tokenValid()
        ? { ready: true, token: _token }
        : { ready: false }
    ));
    return;
  }

  // ── /api/edo/* — proxy to Edo API ────────────────────────────────────────────
  if (parsed.pathname.startsWith('/api/edo')) {
    const forwardPath = parsed.pathname.slice('/api/edo'.length) || '/';
    const target      = new URL(EDO_API_BASE + forwardPath + (parsed.search ?? ''));
    const lib         = target.protocol === 'https:' ? https : http;

    const proxyReq = lib.request(
      {
        hostname: target.hostname,
        port:     target.port || (target.protocol === 'https:' ? 443 : 80),
        path:     target.pathname + target.search,
        method:   req.method,
        headers:  {
          Authorization:  req.headers['authorization'] ?? '',
          'Content-Type': 'application/json',
          Accept:         'application/json',
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] ?? 'application/json',
        });
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('[proxy]', err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error', detail: err.message }));
      }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────────
  const filePath = path.join(
    __dirname,
    parsed.pathname === '/' ? 'index.html' : parsed.pathname
  );

  if (!filePath.startsWith(__dirname + path.sep) && filePath !== __dirname) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error('[error]', err.message);
    if (!res.headersSent) res.writeHead(500).end('Internal server error');
  }
});

server.listen(PORT, () => {
  console.log(`\nEdo Lab dev proxy`);
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log(`  API:    ${EDO_API_BASE}`);
  if (tokenValid()) {
    const exp = new Date(_tokenExpiry).toLocaleTimeString();
    console.log(`  Auth:   cached token valid until ${exp}`);
  } else {
    console.log(`  Auth:   no valid token — open http://localhost:${PORT} and click Authorize`);
  }
  console.log('');
});
