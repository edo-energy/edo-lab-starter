/**
 * edo-dev-config.example.js
 *
 * Copy this file to edo-dev-config.js (gitignored) and fill in your token.
 * When present, edo.js skips the token-entry overlay and connects silently.
 *
 * HOW TO GET YOUR TOKEN
 * ─────────────────────
 * 1. Sign in to the Edo Lab app (or any Edo service).
 * 2. Open DevTools → Network tab.
 * 3. Click any request to /api/...
 * 4. Copy the Authorization header value (everything after "Bearer ").
 * 5. Paste it below.
 *
 * Tokens expire (typically 1 hour). When yours expires, clear sessionStorage
 * in DevTools (Application → Session Storage → Clear All) and refresh to
 * re-enter a fresh token, or update this file.
 */
window.EDO_DEV_CONFIG = {
  token:        'PASTE_YOUR_B2C_TOKEN_HERE',
  proxyBaseUrl: 'http://localhost:3001',   // where dev-proxy.js is running
};
