const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY_NAME = 'old age';
const ADMIN_KEY = process.env.ADMIN_KEY || 'old-age-admin';
const PORT = process.env.PORT || 3000;

const metrics = {
  totalRequests: 0,
  totalWebSockets: 0,
  totalBytesIn: 0,
  totalBytesOut: 0,
  requestsByStatus: {},
  requestsByMethod: {},
  activeConnections: 0,
  startedAt: new Date(),
  requestLog: [],
  errors: []
};

const stealthMode = {
  enabled: process.env.STEALTH === 'true' || false,
  headers: [
    'x-proxy-by',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'via',
    'x-real-ip'
  ],
  randomizeTimings: true,
  injectRandomLatency: () => Math.random() * 100 + 10
};

const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
];

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function addMetric(method, statusCode) {
  metrics.totalRequests++;
  metrics.requestsByMethod[method] = (metrics.requestsByMethod[method] || 0) + 1;
  const code = String(statusCode);
  metrics.requestsByStatus[code] = (metrics.requestsByStatus[code] || 0) + 1;
}

function addRequestLog(req, target, statusCode, latency) {
  const entry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    target,
    statusCode,
    latency,
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] || 'unknown'
  };
  metrics.requestLog.push(entry);
  if (metrics.requestLog.length > 500) {
    metrics.requestLog.shift();
  }
}

function addError(error, context) {
  const entry = {
    timestamp: new Date().toISOString(),
    error: error.message || String(error),
    context,
    stack: error.stack
  };
  metrics.errors.push(entry);
  if (metrics.errors.length > 100) {
    metrics.errors.shift();
  }
}

function isAdminRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.toLowerCase();
  if (path === '/__oldage_admin' || path === '/__oldage_dash') {
    const key = url.searchParams.get('key');
    const headerKey = req.headers['x-admin-key'];
    const auth = req.headers.authorization || '';
    return key === ADMIN_KEY || headerKey === ADMIN_KEY || auth === `Bearer ${ADMIN_KEY}`;
  }
  return false;
}

function renderAdminDashboard(res, req) {
  const isValid = isAdminRequest(req);
  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }, null, 2));
    return;
  }

  const uptime = Date.now() - metrics.startedAt.getTime();
  const uptimeSeconds = Math.floor(uptime / 1000);
  const uptimeDays = Math.floor(uptimeSeconds / 86400);
  const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
  const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

  const statusRows = Object.entries(metrics.requestsByStatus).map(([code, count]) => {
    let badgeClass = 'status-badge status-5xx';
    if (code.startsWith('2')) badgeClass = 'status-badge status-2xx';
    else if (code.startsWith('3')) badgeClass = 'status-badge status-3xx';
    else if (code.startsWith('4')) badgeClass = 'status-badge status-4xx';
    return `
      <div class="metric-card">
        <div class="metric-label">${code}</div>
        <div class="metric-value">${count}</div>
        <span class="${badgeClass}">${code}</span>
      </div>
    `;
  }).join('');

  const requestRows = metrics.requestLog.slice(-20).reverse().map(log => {
    let badgeClass = 'status-badge status-5xx';
    if (String(log.statusCode).startsWith('2')) badgeClass = 'status-badge status-2xx';
    else if (String(log.statusCode).startsWith('3')) badgeClass = 'status-badge status-3xx';
    else if (String(log.statusCode).startsWith('4')) badgeClass = 'status-badge status-4xx';
    return `
      <tr>
        <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
        <td><strong>${log.method}</strong></td>
        <td title="${log.target}">${log.target}</td>
        <td><span class="${badgeClass}">${log.statusCode}</span></td>
        <td>${log.latency}ms</td>
      </tr>
    `;
  }).join('');

  const methodCards = Object.entries(metrics.requestsByMethod).map(([method, count]) => `
    <div class="metric-card">
      <div class="metric-label">${method}</div>
      <div class="metric-value">${count}</div>
    </div>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${PROXY_NAME} Dashboard</title>
        <style>
          :root {
            --bg: #0f172a;
            --surface: #111827;
            --card: #1f2937;
            --primary: #8b5cf6;
            --secondary: #22d3ee;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --text: #f1f5f9;
            --muted: #94a3b8;
            --border: #334155;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, var(--bg) 0%, #020617 100%);
            color: var(--text);
            line-height: 1.6;
          }
          .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
          header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 32px; padding-bottom: 20px; border-bottom: 1px solid var(--border);
          }
          h1 {
            font-size: 2.5rem; background: linear-gradient(135deg, var(--primary), var(--secondary));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          }
          .uptime { color: var(--muted); font-size: 0.9rem; }
          .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 32px; }
          .metric-card {
            background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
          }
          .metric-label {
            color: var(--muted); font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
          }
          .metric-value { font-size: 2rem; font-weight: 700; color: var(--secondary); }
          .section { margin-bottom: 32px; }
          .section-title { font-size: 1.5rem; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid var(--primary); display: inline-block; }
          .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
          .status-2xx { background: rgba(16, 185, 129, 0.2); color: var(--success); }
          .status-3xx { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
          .status-4xx { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
          .status-5xx { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 14px 16px; border-bottom: 1px solid var(--border); text-align: left; }
          th { background: rgba(139, 92, 246, 0.08); color: var(--secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
          tbody tr:hover { background: rgba(139, 92, 246, 0.05); }
          .status-indicator { display: inline-flex; align-items: center; gap: 8px; }
          .status-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--success); animation: pulse 2s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
          .config { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
          .code-block { background: rgba(15, 23, 42, 0.7); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: #e5e7eb; font-family: 'Courier New', monospace; font-size: 0.85rem; }
          .footer { text-align: center; color: var(--muted); font-size: 0.9rem; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--border); }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <div>
              <h1>${PROXY_NAME}</h1>
              <div class="uptime">Uptime: ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m</div>
            </div>
            <div class="status-indicator">
              <div class="status-dot"></div>
              <span>Operational</span>
            </div>
          </header>

          <div class="grid">
            <div class="metric-card"><div class="metric-label">Total Requests</div><div class="metric-value">${metrics.totalRequests}</div></div>
            <div class="metric-card"><div class="metric-label">WebSocket Count</div><div class="metric-value">${metrics.totalWebSockets}</div></div>
            <div class="metric-card"><div class="metric-label">Bytes In</div><div class="metric-value">${(metrics.totalBytesIn / 1024 / 1024).toFixed(2)} MB</div></div>
            <div class="metric-card"><div class="metric-label">Active Connections</div><div class="metric-value">${metrics.activeConnections}</div></div>
          </div>

          <div class="section">
            <h2 class="section-title">Request Methods</h2>
            <div class="grid">${methodCards || '<div class="metric-card"><div class="metric-label">No requests yet</div><div class="metric-value">0</div></div>'}</div>
          </div>

          <div class="section">
            <h2 class="section-title">Status Codes</h2>
            <div class="grid">${statusRows || '<div class="metric-card"><div class="metric-label">No status data</div><div class="metric-value">0</div></div>'}</div>
          </div>

          <div class="section">
            <h2 class="section-title">Recent Requests</h2>
            <div style="overflow-x:auto; background: var(--card); border: 1px solid var(--border); border-radius: 12px;">
              <table>
                <thead><tr><th>Time</th><th>Method</th><th>Target</th><th>Status</th><th>Latency</th></tr></thead>
                <tbody>${requestRows || '<tr><td colspan="5">No requests captured</td></tr>'}</tbody>
              </table>
            </div>
          </div>

          <div class="section">
            <h2 class="section-title">Configuration</h2>
            <div class="config">
              <div class="metric-card"><div class="metric-label">Proxy Usage</div><div class="code-block">/?url=https://example.com</div></div>
              <div class="metric-card"><div class="metric-label">WebSocket</div><div class="code-block">/ws://example.com/socket</div></div>
              <div class="metric-card"><div class="metric-label">Admin URL</div><div class="code-block">/__oldage_admin?key=${ADMIN_KEY}</div></div>
            </div>
          </div>

          <div class="footer">${PROXY_NAME} v2.0 • Advanced Proxy Engine • Stealth mode ${stealthMode.enabled ? 'enabled' : 'disabled'}</div>
        </div>
      </body>
    </html>
  `;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderHome(res) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${PROXY_NAME}</title>
        <style>
          :root {
            --bg: #0f172a;
            --surface: #111827;
            --card: #1f2937;
            --primary: #8b5cf6;
            --secondary: #22d3ee;
            --text: #f1f5f9;
            --muted: #94a3b8;
            --border: #334155;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0; min-height: 100vh; display: grid; place-items: center;
            background: radial-gradient(circle at top, #111827 0%, #020617 100%);
            color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }
          .shell {
            width: min(920px, 92vw); background: rgba(17, 24, 39, 0.95); border: 1px solid rgba(34, 211, 238, 0.3);
            box-shadow: 0 20px 60px rgba(139, 92, 246, 0.2); border-radius: 20px; padding: 40px;
          }
          h1 {
            margin: 0 0 12px; font-size: clamp(2rem, 5vw, 3.5rem); letter-spacing: 0.06em;
            background: linear-gradient(135deg, var(--secondary), var(--primary));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          }
          .tagline { color: var(--muted); font-size: 1.1rem; margin-bottom: 28px; }
          .form-wrap { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
          input {
            flex: 1 1 540px; min-width: 220px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.3);
            color: var(--text); border-radius: 12px; padding: 14px 16px; font-size: 1rem;
          }
          input:focus { outline: none; border-color: var(--secondary); box-shadow: 0 0 12px rgba(34, 211, 238, 0.2); }
          button {
            border: none; border-radius: 12px; background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white; padding: 14px 24px; font-weight: 700; cursor: pointer; font-size: 1rem;
          }
          .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
          .card {
            background: rgba(31, 41, 55, 0.8); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 12px; padding: 16px;
          }
          .card strong { display: block; margin-bottom: 8px; color: var(--secondary); font-size: 0.8rem; letter-spacing: 0.05em; text-transform: uppercase; }
          code {
            background: rgba(15, 23, 42, 0.9); color: #a8e6cf; border-radius: 6px; padding: 3px 8px; font-family: 'Courier New', monospace; font-size: 0.85rem;
          }
          .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 24px; }
          .feature { color: var(--muted); }
          .feature::before { content: '✓ '; color: #10b981; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="shell">
          <h1>${PROXY_NAME}</h1>
          <p class="tagline">The ultimate, overpowered proxy for anything on the internet.</p>
          <form method="GET" action="/">
            <div class="form-wrap">
              <input type="text" name="url" placeholder="https://example.com" autocomplete="off" spellcheck="false" required />
              <button type="submit">Open</button>
            </div>
          </form>

          <div class="cards">
            <div class="card"><strong>Query</strong><code>/?url=https://example.com</code></div>
            <div class="card"><strong>Path</strong><code>/https://example.com/path</code></div>
            <div class="card"><strong>Socket</strong><code>/ws://example.com/socket</code></div>
            <div class="card"><strong>Admin</strong><code>/__oldage_admin?key=...</code></div>
          </div>

          <div class="feature-grid">
            <div class="feature">Stealth mode</div>
            <div class="feature">WebSocket support</div>
            <div class="feature">CORS enabled</div>
            <div class="feature">Stream friendly</div>
            <div class="feature">Header rewriting</div>
            <div class="feature">Modern dashboard</div>
          </div>
        </div>
      </body>
    </html>
  `;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderError(res, title, message, extra = '') {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #111827 0%, #020617 100%); color: #f1f5f9; font-family: Arial, sans-serif; }
          .box { width: min(680px, 92vw); background: #1f2937; border-left: 6px solid #ef4444; border-radius: 14px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
          h1 { margin-top: 0; color: #fca5a5; }
          a { color: #22d3ee; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>${title}</h1>
          <p>${message}</p>
          <p style="color: #94a3b8;">${extra}</p>
          <p><a href="/">back to ${PROXY_NAME}</a></p>
        </div>
      </body>
    </html>
  `;
  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function resolveTargetFromRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const explicit = url.searchParams.get('url') || url.searchParams.get('target');
  if (explicit) return explicit;
  const path = url.pathname;
  if (path && path !== '/') {
    const decoded = decodeURIComponent(path.startsWith('/') ? path.slice(1) : path);
    if (decoded) return decoded;
  }
  return '';
}

function sanitizeTarget(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('No target URL supplied.');
  }

  let value = decodeURIComponent(raw.trim());
  if (!value) throw new Error('No target URL supplied.');

  if (!/^https?:\/\//i.test(value) && !/^wss?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  const parsed = new URL(value);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    throw new Error('Only http, https, ws, and wss targets are supported.');
  }

  return parsed;
}

function stripHopByHop(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function getStealthUA() {
  return STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)];
}

function browserifyHeaders(req, target, isWebSocket = false) {
  const base = { ...req.headers };
  delete base.host;
  delete base.connection;
  delete base['content-length'];
  delete base['transfer-encoding'];
  delete base.upgrade;

  const ua = stealthMode.enabled ? getStealthUA() : (base['user-agent'] || getStealthUA());

  base['user-agent'] = ua;
  base.accept = base.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  base['accept-language'] = base['accept-language'] || 'en-US,en;q=0.9';
  base['accept-encoding'] = base['accept-encoding'] || 'gzip, deflate, br';
  base['upgrade-insecure-requests'] = base['upgrade-insecure-requests'] || '1';
  base['sec-fetch-mode'] = base['sec-fetch-mode'] || (isWebSocket ? 'websocket' : 'navigate');
  base['sec-fetch-site'] = base['sec-fetch-site'] || 'cross-site';
  base['sec-fetch-dest'] = base['sec-fetch-dest'] || (isWebSocket ? 'websocket' : 'document');
  base['cache-control'] = base['cache-control'] || 'no-cache';
  base.pragma = base.pragma || 'no-cache';
  base.origin = base.origin || target.origin;
  base.referer = base.referer || `${target.origin}/`;

  if (stealthMode.enabled) {
    stealthMode.headers.forEach(h => delete base[h.toLowerCase()]);
  }

  return base;
}

function rewriteResponseHeaders(headers = {}) {
  const out = { ...headers };
  if (!stealthMode.enabled) out['X-Proxy-By'] = PROXY_NAME;
  out['Access-Control-Allow-Origin'] = '*';
  out['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
  out['Access-Control-Allow-Headers'] = '*';
  out['Access-Control-Expose-Headers'] = '*';
  out['X-Content-Type-Options'] = 'nosniff';

  delete out['content-security-policy'];
  delete out['content-security-policy-report-only'];
  delete out['x-frame-options'];
  delete out['cross-origin-opener-policy'];
  delete out['cross-origin-resource-policy'];
  delete out['permissions-policy'];
  if (!stealthMode.enabled) delete out['server'];

  return out;
}

function proxyHttpRequest(targetUrl, req, res) {
  const target = new URL(targetUrl);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = browserifyHeaders(req, target, false);
  headers.host = target.host;

  const startTime = Date.now();
  metrics.activeConnections++;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}${target.hash}`,
    method: req.method,
    headers,
    timeout: 30000
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const latency = Date.now() - startTime;
    const responseHeaders = rewriteResponseHeaders(stripHopByHop(proxyRes.headers));
    res.writeHead(proxyRes.statusCode, responseHeaders);

    addMetric(req.method, proxyRes.statusCode);
    addRequestLog(req, target.toString(), proxyRes.statusCode, latency);

    if (req.method === 'HEAD') {
      proxyRes.resume();
      metrics.activeConnections--;
      return;
    }

    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    metrics.activeConnections--;
    addError(err, 'HTTP proxy request');
    renderError(res, 'Proxy error', 'The upstream request failed.', err.message || 'Unknown proxy problem');
  });

  proxyReq.on('timeout', () => {
    metrics.activeConnections--;
    proxyReq.destroy(new Error('Request timed out.'));
  });

  req.on('data', chunk => {
    metrics.totalBytesIn += chunk.length;
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

function proxyWebSocketRequest(targetUrl, req, socket, head) {
  const target = sanitizeTarget(targetUrl);
  const isSecure = target.protocol === 'wss:';
  metrics.activeConnections++;
  metrics.totalWebSockets++;

  const upstream = (isSecure ? tls : net).connect({
    host: target.hostname,
    port: target.port || (isSecure ? 443 : 80),
    servername: target.hostname
  }, () => {
    const key = req.headers['sec-websocket-key'];
    const request = [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      `Origin: ${req.headers.origin || target.origin}`
    ];
    if (req.headers['sec-websocket-protocol']) request.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    request.push('', '');
    upstream.write(request.join('\r\n'));
    if (head && head.length) upstream.write(head);
  });

  let handshakeCompleted = false;
  let handshakeBuffer = Buffer.alloc(0);

  upstream.on('data', (chunk) => {
    if (!handshakeCompleted) {
      handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
      const endIndex = handshakeBuffer.indexOf(Buffer.from('\r\n\r\n'));
      if (endIndex === -1) return;
      const rawHeaders = handshakeBuffer.subarray(0, endIndex + 4).toString('utf8');
      const [statusLine, ...headerLines] = rawHeaders.split('\r\n');
      const statusMatch = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
      const responseHeaders = {};
      for (const line of headerLines) {
        if (!line.trim()) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        responseHeaders[key] = value;
      }
      const remaining = handshakeBuffer.subarray(endIndex + 4);
      if (statusCode === 101) {
        const finalHeaders = Object.entries(responseHeaders)
          .filter(([key]) => !HOP_BY_HOP.has(key.toLowerCase()))
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${finalHeaders}\r\n\r\n`);
        handshakeCompleted = true;
        if (remaining.length) socket.write(remaining);
      } else {
        socket.end(Buffer.from(rawHeaders));
        upstream.destroy();
        metrics.activeConnections--;
        return;
      }
    } else {
      socket.write(chunk);
    }
  });

  socket.on('data', (chunk) => { if (handshakeCompleted) upstream.write(chunk); });
  socket.on('close', () => { upstream.destroy(); metrics.activeConnections--; });
  socket.on('error', () => { upstream.destroy(); metrics.activeConnections--; });
  upstream.on('close', () => { socket.end(); metrics.activeConnections--; });
  upstream.on('error', () => { socket.destroy(); metrics.activeConnections--; });
}

function handleProxyRequest(req, res) {
  const rawTarget = resolveTargetFromRequest(req);
  if (!rawTarget) {
    renderError(res, 'Bad request', 'You need a target URL.', 'Example: /?url=https://example.com');
    return;
  }
  try {
    const target = sanitizeTarget(rawTarget);
    if (target.protocol === 'ws:' || target.protocol === 'wss:') {
      renderError(res, 'WebSocket route', 'Use the WebSocket upgrade handler.', '');
      return;
    }
    proxyHttpRequest(target.toString(), req, res);
  } catch (err) {
    addError(err, 'Proxy request handling');
    renderError(res, 'Invalid target', 'The URL could not be parsed safely.', err.message || 'Unknown target parsing error');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': '*'
    });
    res.end();
    return;
  }

  if (url.pathname === '/__oldage_admin' || url.pathname === '/__oldage_dash') {
    renderAdminDashboard(res, req);
    return;
  }

  if (url.pathname === '/' && !url.searchParams.has('url') && !url.searchParams.has('target')) {
    renderHome(res);
    return;
  }

  handleProxyRequest(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const rawTarget = resolveTargetFromRequest(req);
  if (!rawTarget) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const target = sanitizeTarget(rawTarget);
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    proxyWebSocketRequest(target.toString(), req, socket, head);
  } catch (err) {
    addError(err, 'WebSocket upgrade');
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`\n✨ ${PROXY_NAME} v2.0 is operational\n`);
  console.log(`📍 Listen: http://localhost:${PORT}`);
  console.log(`🚀 Proxy: http://localhost:${PORT}/?url=https://example.com`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/__oldage_admin?key=${ADMIN_KEY}`);
  console.log(`🛡️ Stealth: ${stealthMode.enabled ? 'ENABLED' : 'disabled'}\n`);
});
