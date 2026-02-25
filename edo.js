/**
 * edo.js — Edo Lab Project SDK  v1
 *
 * Handles authentication for two contexts:
 *
 *   Production (iframe inside Edo Lab):
 *     Signals EDO_READY to parent, waits for EDO_TOKEN via postMessage.
 *
 *   Standalone / local dev (opened directly in a browser):
 *     1. Looks for window.EDO_DEV_CONFIG set by a gitignored edo-dev-config.js.
 *     2. Falls back to sessionStorage (survives page reloads within a session).
 *     3. Shows a token-entry overlay if neither is found.
 *
 * Usage:
 *   await edo.ready();
 *   const sites   = await edo.get('/buildings');
 *   const points  = await edo.get('/buildings/42/points', { pageSize: 500, pointClassId: 7 });
 *   const latest  = await edo.get('/timeseries/latest', { id: [1, 2, 3] });
 *   const rollup  = await edo.get('/timeseries/rollup', {
 *                     id: [1, 2], interval: '1', unit: 'hour',
 *                     start: '2025-12-01T00:00:00Z', end: '2025-12-08T00:00:00Z' });
 */
const edo = (() => {
  let _token    = null;
  let _proxyBase = null;
  let _resolve;
  const _ready = new Promise(r => { _resolve = r; });

  const _standalone = window.parent === window;

  if (_standalone) {
    // ── Standalone / dev mode ──────────────────────────────────────────────────
    const cfg = window.EDO_DEV_CONFIG;
    if (cfg?.token) {
      // edo-dev-config.js is present — connect silently
      _token    = cfg.token;
      _proxyBase = cfg.proxyBaseUrl ?? 'http://localhost:3001';
      setTimeout(_resolve, 0);
    } else {
      _initDevOverlay();
    }
  } else {
    // ── Iframe / production mode ───────────────────────────────────────────────
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'EDO_TOKEN') return;
      _token    = event.data.token;
      _proxyBase = event.data.proxyBaseUrl;
      _resolve();
    });

    function signalReady() {
      const parentOrigin = document.referrer ? new URL(document.referrer).origin : '*';
      window.parent.postMessage({ type: 'EDO_READY' }, parentOrigin);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', signalReady);
    } else {
      signalReady();
    }
  }

  // ── Dev overlay ─────────────────────────────────────────────────────────────

  function _initDevOverlay() {
    // Check sessionStorage first — token survives reload within a browser session
    const saved = sessionStorage.getItem('EDO_DEV_TOKEN');
    if (saved) {
      _token     = saved;
      _proxyBase = sessionStorage.getItem('EDO_DEV_PROXY') || 'http://localhost:3001';
      setTimeout(_resolve, 0);
      return;
    }

    document.addEventListener('DOMContentLoaded', async () => {
      const hashProxy = new URLSearchParams(window.location.hash.slice(1)).get('proxy');
      const proxyUrl  = hashProxy || 'http://localhost:3001';

      // If dev-proxy is already running with a valid token, connect silently
      try {
        const r = await fetch(`${proxyUrl}/api/dev-auth/status`);
        const d = await r.json();
        if (d.ready) {
          _token     = d.token;
          _proxyBase = proxyUrl;
          sessionStorage.setItem('EDO_DEV_TOKEN', d.token);
          sessionStorage.setItem('EDO_DEV_PROXY', proxyUrl);
          _resolve();
          return;
        }
      } catch { /* dev-proxy not running — show overlay */ }

      // ── Build overlay ────────────────────────────────────────────────────────
      const el = document.createElement('div');
      el.style.cssText = [
        'position:fixed;inset:0;z-index:9999',
        'background:rgba(40,39,101,0.97)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'color:#fff;gap:20px;padding:24px',
      ].join(';');
      el.innerHTML = `
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.4)">
          Edo Lab — Dev Mode
        </div>
        <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;text-align:center;max-width:560px;line-height:1.15">
          Connect to Edo
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,0.55);max-width:500px;text-align:center;line-height:1.65">
          Run <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px">node dev-proxy.js</code>
          then click Authorize. Your token will be cached for future sessions.
        </div>
        <button id="_edo_auth"
          style="padding:14px 40px;background:#3EC87A;color:#282765;border:none;
                 border-radius:6px;font-weight:800;font-size:14px;cursor:pointer;letter-spacing:0.02em">
          Authorize with Edo
        </button>
        <div id="_edo_status" style="font-size:12px;color:rgba(255,255,255,0.4);min-height:16px;text-align:center"></div>
        <div style="display:flex;align-items:center;gap:12px;width:100%;max-width:500px">
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.1)"></div>
          <span style="font-size:11px;color:rgba(255,255,255,0.3);white-space:nowrap">or paste token manually</span>
          <div style="flex:1;height:1px;background:rgba(255,255,255,0.1)"></div>
        </div>
        <div style="display:flex;gap:8px;width:100%;max-width:540px">
          <input id="_edo_tok" type="password" placeholder="eyJ0eXAiOiJKV1Qi…"
            style="flex:1;min-width:0;padding:13px 16px;border-radius:6px;font-size:13px;
                   border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.07);
                   color:#fff;outline:none" />
          <button id="_edo_btn"
            style="padding:13px 20px;background:rgba(255,255,255,0.1);color:#fff;
                   border:1px solid rgba(255,255,255,0.2);border-radius:6px;
                   font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">
            Connect
          </button>
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,0.3)">
          Proxy → <span id="_edo_proxy">${proxyUrl}</span>
        </div>`;

      document.body.appendChild(el);

      // ── Shared connect helper ────────────────────────────────────────────────
      let _poll = null;

      function finishConnect(token) {
        if (_poll) { clearInterval(_poll); _poll = null; }
        _token     = token;
        _proxyBase = proxyUrl;
        sessionStorage.setItem('EDO_DEV_TOKEN', token);
        sessionStorage.setItem('EDO_DEV_PROXY', proxyUrl);
        el.remove();
        _resolve();
      }

      // ── Authorize button — PKCE flow via dev-proxy ───────────────────────────
      document.getElementById('_edo_auth').addEventListener('click', () => {
        const statusEl = document.getElementById('_edo_status');
        const popup = window.open(
          `${proxyUrl}/oauth/start`, 'edo_auth', 'width=520,height=640'
        );
        if (!popup) {
          statusEl.textContent = 'Popup blocked — allow popups for localhost, or paste your token below.';
          return;
        }
        statusEl.textContent = 'Waiting for authorization…';

        // Poll dev-proxy for token (handles popup blocked + opener not set)
        _poll = setInterval(async () => {
          try {
            const r = await fetch(`${proxyUrl}/api/dev-auth/status`);
            const d = await r.json();
            if (d.ready) finishConnect(d.token);
          } catch {
            clearInterval(_poll); _poll = null;
            statusEl.textContent = 'Dev proxy not responding — paste your token below.';
          }
        }, 1500);
      });

      // postMessage from the callback popup — immediate connect on success
      window.addEventListener('message', async (event) => {
        if (event.data === 'edo_auth_ok') {
          try {
            const r = await fetch(`${proxyUrl}/api/dev-auth/status`);
            const d = await r.json();
            if (d.ready) finishConnect(d.token);
          } catch { /* poll will catch it */ }
        }
        if (event.data === 'edo_auth_error') {
          document.getElementById('_edo_status').textContent =
            'Authorization failed — paste your token below.';
        }
      });

      // ── Paste fallback ───────────────────────────────────────────────────────
      function connectWithToken() {
        const raw   = document.getElementById('_edo_tok').value.trim();
        const token = raw.replace(/^Bearer\s+/i, '');
        if (!token) return;
        finishConnect(token);
      }

      document.getElementById('_edo_btn').addEventListener('click', connectWithToken);
      document.getElementById('_edo_tok').addEventListener('keydown', e => {
        if (e.key === 'Enter') connectWithToken();
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Returns a Promise that resolves once auth is established.
   * Await this before making any get() calls if you need to gate on auth.
   */
  function ready() { return _ready; }

  /**
   * Authenticated GET to any Edo Lab API route.
   *
   * @param {string} path    e.g. '/buildings', '/timeseries/latest'
   * @param {Object} params  query params; arrays become repeated keys (?id=1&id=2)
   * @returns {Promise<any>} parsed JSON
   */
  async function get(path, params = {}) {
    await _ready;
    const url = new URL(`/api/edo${path}`, _proxyBase);
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        v.forEach(x => url.searchParams.append(k, String(x)));
      } else if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    });
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${_token}` },
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Edo API ${res.status} ${path}${msg ? ': ' + msg.slice(0, 200) : ''}`);
    }
    return res.json();
  }

  return { ready, get };
})();
