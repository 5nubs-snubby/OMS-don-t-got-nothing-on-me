const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY_NAME = 'old age';
const ADMIN_KEY = process.env.ADMIN_KEY || 'old-age-admin';
const PORT = Number(process.env.PORT || 3000);

const stats = {
  totalRequests: 0,
  totalWebSockets: 0,
  activeConnections: 0,
  startedAt: new Date(),
  requestsByMethod: {},
  requestsByStatus: {},
  requestLog: [],
  errors: []
};

const stealthMode = {
  enabled: process.env.STEALTH === 'true',
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
  ]
};

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
  stats.totalRequests += 1;
  stats.requestsByMethod[method] = (stats.requestsByMethod[method] || 0) + 1;
  const code = String(statusCode);
  stats.requestsByStatus[code] = (stats.requestsByStatus[code] || 0) + 1;
}

function addRequestLog(req, target, statusCode, latency) {
  stats.requestLog.push({
    timestamp: new Date().toISOString(),
    method: req.method,
    target,
    statusCode,
    latency,
    ip: req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] || 'unknown'
  });
  if (stats.requestLog.length > 50) stats.requestLog.shift();
}

function addError(error, context) {
  stats.errors.push({
    timestamp: new Date().toISOString(),
    context,
    error: error && error.message ? error.message : String(error)
  });
  if (stats.errors.length > 20) stats.errors.shift();
}

function isAdminRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.toLowerCase();
  if (path === '/__oldage_admin') {
    const key = url.searchParams.get('key');
    const headerKey = req.headers['x-admin-key'];
    const auth = req.headers.authorization || '';
    return key === ADMIN_KEY || headerKey === ADMIN_KEY || auth === `Bearer ${ADMIN_KEY}`;
  }
  return false;
}

function renderAdminDashboard(res, req) {
  if (!isAdminRequest(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }, null, 2));
    return;
  }

  const now = Date.now();
  const elapsedMs = now - stats.startedAt.getTime();
  const uptime = {
    days: Math.floor(elapsedMs / 86400000),
    hours: Math.floor((elapsedMs % 86400000) / 3600000),
    minutes: Math.floor((elapsedMs % 3600000) / 60000)
  };

  const methodCards = Object.entries(stats.requestsByMethod).map(([method, count]) => `
    <div class="metric-card">
      <div class="metric-label">${method}</div>
      <div class="metric-value">${count}</div>
    </div>
  `).join('');

  const statusCards = Object.entries(stats.requestsByStatus).map(([code, count]) => {
    let klass = 'status-badge status-5xx';
    if (code.startsWith('2')) klass = 'status-badge status-2xx';
    else if (code.startsWith('3')) klass = 'status-badge status-3xx';
    else if (code.startsWith('4')) klass = 'status-badge status-4xx';
    return `
      <div class="metric-card">
        <div class="metric-label">Status ${code}</div>
        <div class="metric-value">${count}</div>
        <span class="${klass}">${code}</span>
      </div>
    `;
  }).join('');

  const logRows = stats.requestLog.slice(-10).reverse().map(item => {
    let klass = 'status-badge status-5xx';
    if (String(item.statusCode).startsWith('2')) klass = 'status-badge status-2xx';
    else if (String(item.statusCode).startsWith('3')) klass = 'status-badge status-3xx';
    else if (String(item.statusCode).startsWith('4')) klass = 'status-badge status-4xx';
    return `
      <tr>
        <td>${new Date(item.timestamp).toLocaleTimeString()}</td>
        <td>${item.method}</td>
        <td title="${item.target}">${item.target}</td>
        <td><span class="${klass}">${item.statusCode}</span></td>
        <td>${item.latency}ms</td>
      </tr>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${PROXY_NAME} Dashboard</title>
        <style>
          :root { --bg:#0f172a; --card:#111827; --muted:#94a3b8; --text:#f8fafc; --primary:#8b5cf6; --secondary:#22d3ee; --success:#10b981; --warning:#f59e0b; --danger:#ef4444; --border:#334155; }
          * { box-sizing: border-box; }
          body { margin:0; font-family: Arial, sans-serif; background: linear-gradient(135deg, var(--bg) 0%, #020617 100%); color: var(--text); }
          .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
          header { display:flex; justify-content:space-between; align-items:center; margin-bottom:24px; border-bottom:1px solid var(--border); padding-bottom:18px; }
          h1 { margin:0; font-size:2.5rem; background:linear-gradient(135deg, var(--primary), var(--secondary)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
          .status-pill { display:inline-flex; align-items:center; gap:8px; background:rgba(16, 185, 129, 0.12); color:#a7f3d0; padding:8px 12px; border-radius:99px; border:1px solid rgba(16,185,129,0.4); }
          .dot { width:10px; height:10px; background:var(--success); border-radius:50%; display:inline-block; }
          .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom: 28px; }
          .metric-card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:18px; }
          .metric-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.75rem; }
          .metric-value { font-size: 2rem; font-weight:700; color: var(--secondary); margin-top:6px; }
          .section { margin-bottom: 28px; }
          .section h2 { margin: 0 0 12px; font-size: 1.4rem; }
          table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
          th, td { padding:12px 14px; border-bottom:1px solid var(--border); text-align:left; }
          th { color: var(--secondary); letter-spacing:0.06em; text-transform:uppercase; font-size:0.75rem; }
          .status-badge { display:inline-block; padding:4px 10px; border-radius:999px; font-size:0.78rem; }
          .status-2xx { background: rgba(16,185,129,0.15); color: #a7f3d0; }
          .status-3xx { background: rgba(96,165,250,0.15); color: #bfdbfe; }
          .status-4xx { background: rgba(245,158,11,0.15); color: #fcd34d; }
          .status-5xx { background: rgba(239,68,68,0.15); color: #fecaca; }
          .code { background:rgba(15,23,42,0.85); border:1px solid var(--border); border-radius:10px; padding:10px 12px; font-family: monospace; color:#dbeafe; }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <h1>${PROXY_NAME}</h1>
            <div class="status-pill"><span class="dot"></span>Operational</div>
          </header>

          <div class="grid">
            <div class="metric-card"><div class="metric-label">Total Requests</div><div class="metric-value">${stats.totalRequests}</div></div>
            <div class="metric-card"><div class="metric-label">WebSockets</div><div class="metric-value">${stats.totalWebSockets}</div></div>
            <div class="metric-card"><div class="metric-label">Active</div><div class="metric-value">${stats.activeConnections}</div></div>
            <div class="metric-card"><div class="metric-label">Uptime</div><div class="metric-value">${uptime.days}d ${uptime.hours}h ${uptime.minutes}m</div></div>
          </div>

          <div class="section">
            <h2>Methods</h2>
            <div class="grid">${methodCards || '<div class="metric-card"><div class="metric-label">No requests yet</div><div class="metric-value">0</div></div>'}</div>
          </div>

          <div class="section">
            <h2>Status Codes</h2>
            <div class="grid">${statusCards || '<div class="metric-card"><div class="metric-label">No data</div><div class="metric-value">0</div></div>'}</div>
          </div>

          <div class="section">
            <h2>Recent Requests</h2>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>${logRows || '<tr><td colspan="5">No requests logged yet.</td></tr>'}</tbody>
            </table>
          </div>

          <div class="section">
            <h2>Admin</h2>
            <div class="code">/__oldage_admin?key=${ADMIN_KEY}</div>
          </div>
        </div>
      </body>
    </html>
  `;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderHomePage(res) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>old age | Modern Proxy Portal</title>
        <style>
          :root {
            --bg: #020817;
            --bg2: #0f172a;
            --card: rgba(15, 23, 42, 0.9);
            --card-strong: #111827;
            --primary: #8b5cf6;
            --secondary: #22d3ee;
            --text: #e2e8f0;
            --muted: #94a3b8;
            --line: rgba(148,163,184,0.22);
            --success: #10b981;
          }
          * { box-sizing: border-box; }
          html { scroll-behavior: smooth; }
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: radial-gradient(circle at top, #111827 0%, var(--bg) 38%, #020617 100%);
            color: var(--text);
          }
          a { color: inherit; text-decoration: none; }
          .container { width: min(1200px, 92vw); margin: 0 auto; }
          header {
            position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px);
            background: rgba(2, 8, 23, 0.7); border-bottom: 1px solid var(--line);
          }
          .nav {
            display: flex; justify-content: space-between; align-items: center; min-height: 72px;
          }
          .brand {
            font-size: 1.4rem; letter-spacing: 0.08em; font-weight: 700;
            background: linear-gradient(135deg, var(--secondary), var(--primary));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          }
          .nav-links { display: flex; gap: 22px; color: var(--muted); font-size: 0.95rem; }
          .nav-links a:hover { color: var(--text); }
          .nav-btn {
            padding: 10px 18px; border-radius: 10px; color: white; background: linear-gradient(135deg, var(--primary), var(--secondary));
            border: none; cursor: pointer; font-weight: 700;
          }
          .hero {
            padding: 90px 0 60px;
            display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 32px; align-items: center;
          }
          h1 {
            margin: 0 0 18px; font-size: clamp(2.8rem, 6vw, 5rem); line-height: 1.02; letter-spacing: -0.05em;
            background: linear-gradient(135deg, #f8fafc 0%, var(--secondary) 30%, var(--primary) 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          }
          .lede {
            color: var(--muted); font-size: 1.1rem; line-height: 1.7; max-width: 700px;
          }
          .actions { display:flex; gap:14px; margin-top: 26px; flex-wrap:wrap; }
          .primary-btn, .secondary-btn {
            display:inline-flex; align-items:center; justify-content:center; padding: 16px 20px; border-radius: 12px; font-weight: 700;
            border: 1px solid var(--line); transition: transform 0.2s ease;
          }
          .primary-btn { background: linear-gradient(135deg, var(--primary), var(--secondary)); color: white; }
          .secondary-btn { background: rgba(15,23,42,0.8); color: var(--text); }
          .primary-btn:hover, .secondary-btn:hover { transform: translateY(-2px); }
          .hero-panel {
            background: linear-gradient(180deg, rgba(17,24,39,0.9), rgba(15,23,42,0.8));
            border: 1px solid var(--line); border-radius: 22px; padding: 24px; box-shadow: 0 20px 50px rgba(34,211,238,0.15);
          }
          .mini-form { display:flex; gap:12px; margin-top: 14px; }
          .mini-form input {
            flex: 1; border-radius: 12px; background: rgba(15,23,42,0.9); border:1px solid var(--line); color: var(--text); padding: 14px 16px; font-size: 1rem;
          }
          .mini-form button {
            border: none; padding: 14px 18px; border-radius: 12px; background: linear-gradient(135deg, var(--secondary), var(--primary)); color: white; font-weight: 700;
          }
          .stats-row { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:12px; margin-top:18px; }
          .stat { background: rgba(15, 23, 42, 0.7); border:1px solid var(--line); border-radius: 12px; padding: 12px; }
          .stat strong { display:block; font-size:1.7rem; }
          .stat span { color: var(--muted); font-size: 0.8rem; }
          section { padding: 40px 0; }
          .section-title { font-size: clamp(1.8rem, 3vw, 2.5rem); margin: 0 0 20px; }
          .card-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; }
          .feature-card {
            background: var(--card); border:1px solid var(--line); border-radius: 16px; padding: 20px; min-height: 180px;
          }
          .feature-card h3 { margin: 8px 0 10px; font-size: 1.2rem; }
          .feature-card p { color: var(--muted); line-height: 1.7; }
          .badge { display:inline-block; padding:7px 10px; border-radius:10px; color: var(--secondary); background: rgba(34,211,238,0.08); border: 1px solid rgba(34,211,238,0.3); font-size:0.75rem; text-transform: uppercase; letter-spacing: 0.08em; }
          .showcase {
            display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-top: 28px;
          }
          .showcase-box {
            background: var(--card); border:1px solid var(--line); border-radius: 18px; padding: 20px;
          }
          .showcase-box pre {
            margin:0; white-space: pre-wrap; font-size: 0.9rem; line-height:1.7; color:#bfdbfe; background: rgba(2,6,23,0.85); border-radius: 12px; padding: 16px; border: 1px solid var(--line);
          }
          footer { padding: 24px 0 60px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 40px; }
          @media (max-width: 860px) {
            .hero { grid-template-columns: 1fr; padding-top: 60px; }
            .nav-links { display:none; }
            .showcase { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <header>
          <div class="container nav">
            <div class="brand">old age</div>
            <nav class="nav-links">
              <a href="#features">Features</a>
              <a href="#dashboard">Dashboard</a>
              <a href="#proxy">Proxy</a>
            </nav>
            <a class="nav-btn" href="#proxy">Launch</a>
          </div>
        </header>

        <main class="container">
          <section class="hero">
            <div>
              <h1>Built for speed, stealth, and control.</h1>
              <p class="lede">old age is a modern proxy portal designed to route web requests, support WebSocket traffic, monitor usage, and stay stealthy while preserving a polished product experience.</p>
              <div class="actions">
                <a class="primary-btn" href="#proxy">Open Proxy</a>
                <a class="secondary-btn" href="/__oldage_admin?key=${ADMIN_KEY}" target="_blank">Open Dashboard</a>
              </div>
            </div>
            <div class="hero-panel">
              <div class="badge">Proxy Console</div>
              <form class="mini-form" method="GET" action="/">
                <input type="text" name="url" placeholder="https://example.com" required />
                <button type="submit">Proxy</button>
              </form>
              <div class="stats-row">
                <div class="stat"><strong>${stats.totalRequests}</strong><span>requests</span></div>
                <div class="stat"><strong>${stats.totalWebSockets}</strong><span>websockets</span></div>
                <div class="stat"><strong>${stats.activeConnections}</strong><span>active</span></div>
              </div>
            </div>
          </section>

          <section id="features">
            <h2 class="section-title">Why old age works</h2>
            <div class="card-grid">
              <article class="feature-card">
                <div class="badge">Core</div>
                <h3>Flexible Proxying</h3>
                <p>Send HTTP, HTTPS, and WebSocket traffic through a single streamlined route.</p>
              </article>
              <article class="feature-card">
                <div class="badge">Security</div>
                <h3>Stealth Headers</h3>
                <p>Modern browser-like headers and stealth behavior help maintain a more natural footprint.</p>
              </article>
              <article class="feature-card">
                <div class="badge">Insight</div>
                <h3>Live Monitoring</h3>
                <p>Track requests, status codes, active sockets, and runtime behavior in a built-in dashboard.</p>
              </article>
              <article class="feature-card">
                <div class="badge">UX</div>
                <h3>Modern Frontend</h3>
                <p>A working website feel, polished UI, and clear controls make the system genuinely usable.</p>
              </article>
            </div>
          </section>

          <section id="proxy">
            <h2 class="section-title">Proxy quick start</h2>
            <div class="showcase">
              <div class="showcase-box">
                <h3>Open a site</h3>
                <pre>/?url=https://example.com
/https://example.com/path</pre>
              </div>
              <div class="showcase-box">
                <h3>WebSocket example</h3>
                <pre>/ws://example.com/socket</pre>
              </div>
            </div>
          </section>

          <section id="dashboard">
            <h2 class="section-title">Monitoring dashboard</h2>
            <div class="showcase-box">
              <pre>Admin access: /__oldage_admin?key=${ADMIN_KEY}
Live requests and HTTP status telemetry are logged automatically.</pre>
            </div>
          </section>
        </main>

        <footer>
          <div class="container">old age • modern proxy portal • ${new Date().getFullYear()}</div>
        </footer>
      </body>
    </html>
  `;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sanitizeTarget(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('No target URL supplied.');
  let value = decodeURIComponent(raw.trim());
  if (!value) throw new Error('No target URL supplied.');
  if (!/^https?:\/\//i.test(value) && !/^wss?:\/\//i.test(value)) value = `https://${value}`;
  const parsed = new URL(value);
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) throw new Error('Only http, https, ws, and wss are supported.');
  return parsed;
}

function stripHopByHop(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

function getStealthUA() {
  return stealthMode.userAgents[Math.floor(Math.random() * stealthMode.userAgents.length)];
}

function browserifyHeaders(req, target) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  if (stealthMode.enabled) {
    delete headers['x-forwarded-for'];
    delete headers['x-forwarded-host'];
    delete headers['x-forwarded-proto'];
  }
  headers['user-agent'] = stealthMode.enabled ? getStealthUA() : (headers['user-agent'] || getStealthUA());
  headers.accept = headers.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  headers['accept-language'] = headers['accept-language'] || 'en-US,en;q=0.9';
  headers['accept-encoding'] = headers['accept-encoding'] || 'gzip, deflate, br';
  headers['upgrade-insecure-requests'] = headers['upgrade-insecure-requests'] || '1';
  headers.origin = headers.origin || target.origin;
  headers.referer = headers.referer || `${target.origin}/`;
  return headers;
}

function rewriteResponseHeaders(headers = {}) {
  const out = { ...headers };
  out['Access-Control-Allow-Origin'] = '*';
  out['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
  out['Access-Control-Allow-Headers'] = '*';
  out['Access-Control-Expose-Headers'] = '*';
  out['X-Content-Type-Options'] = 'nosniff';
  delete out['content-security-policy'];
  delete out['content-security-policy-report-only'];
  delete out['x-frame-options'];
  delete out['permissions-policy'];
  delete out['cross-origin-opener-policy'];
  return out;
}

function proxyHttpRequest(targetUrl, req, res) {
  const target = new URL(targetUrl);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = browserifyHeaders(req, target);
  headers.host = target.host;
  const start = Date.now();
  stats.activeConnections += 1;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}${target.hash}`,
    method: req.method,
    headers,
    timeout: 30000
  };

  const proxied = transport.request(options, (proxyRes) => {
    const latency = Date.now() - start;
    const finalHeaders = rewriteResponseHeaders(stripHopByHop(proxyRes.headers));
    res.writeHead(proxyRes.statusCode, finalHeaders);
    addMetric(req.method, proxyRes.statusCode);
    addRequestLog(req, target.toString(), proxyRes.statusCode, latency);

    if (req.method === 'HEAD') {
      proxyRes.resume();
      stats.activeConnections = Math.max(0, stats.activeConnections - 1);
      return;
    }

    proxyRes.pipe(res);
    proxyRes.on('end', () => {
      stats.activeConnections = Math.max(0, stats.activeConnections - 1);
    });
  });

  proxied.on('error', (err) => {
    stats.activeConnections = Math.max(0, stats.activeConnections - 1);
    addError(err, 'HTTP proxy request');
    renderError(res, 'Proxy error', 'The upstream request failed.', err.message || 'Unknown proxy problem');
  });

  proxied.on('timeout', () => {
    stats.activeConnections = Math.max(0, stats.activeConnections - 1);
    proxied.destroy(new Error('Request timed out.'));
  });

  req.on('data', chunk => {});
  if (req.method === 'GET' || req.method === 'HEAD') proxied.end();
  else req.pipe(proxied);
}

function proxyWebSocketRequest(targetUrl, req, socket, head) {
  const target = sanitizeTarget(targetUrl);
  const isSecure = target.protocol === 'wss:';
  stats.totalWebSockets += 1;
  stats.activeConnections += 1;

  const upstream = (isSecure ? tls : net).connect({
    host: target.hostname,
    port: target.port || (isSecure ? 443 : 80),
    servername: target.hostname
  }, () => {
    const key = req.headers['sec-websocket-key'];
    const lines = [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      `Origin: ${req.headers.origin || target.origin}`
    ];
    if (req.headers['sec-websocket-protocol']) lines.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head && head.length) upstream.write(head);
  });

  let handshakeDone = false;
  let buffer = Buffer.alloc(0);

  upstream.on('data', (chunk) => {
    if (!handshakeDone) {
      buffer = Buffer.concat([buffer, chunk]);
      const idx = buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (idx === -1) return;
      const raw = buffer.subarray(0, idx + 4).toString('utf8');
      const [statusLine, ...headersList] = raw.split('\r\n');
      const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d+)/);
      const statusCode = match ? Number(match[1]) : 0;
      const pending = buffer.subarray(idx + 4);
      if (statusCode === 101) {
        const replyHeaders = {};
        for (const line of headersList) {
          if (!line.trim()) continue;
          const split = line.indexOf(':');
          if (split === -1) continue;
          const key = line.slice(0, split).trim();
          const value = line.slice(split + 1).trim();
          replyHeaders[key] = value;
        }
        const finalHeaders = Object.entries(replyHeaders)
          .filter(([key]) => !HOP_BY_HOP.has(key.toLowerCase()))
          .map(([key, value]) => `${key}: ${value}`)
          .join('\r\n');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${finalHeaders}\r\n\r\n`);
        handshakeDone = true;
        if (pending.length) socket.write(pending);
      } else {
        socket.end(Buffer.from(raw));
        upstream.destroy();
        stats.activeConnections = Math.max(0, stats.activeConnections - 1);
      }
    } else {
      socket.write(chunk);
    }
  });

  socket.on('data', (chunk) => { if (handshakeDone) upstream.write(chunk); });
  socket.on('close', () => { upstream.destroy(); stats.activeConnections = Math.max(0, stats.activeConnections - 1); });
  socket.on('error', () => { upstream.destroy(); stats.activeConnections = Math.max(0, stats.activeConnections - 1); });
  upstream.on('close', () => { socket.end(); stats.activeConnections = Math.max(0, stats.activeConnections - 1); });
  upstream.on('error', () => { socket.destroy(); stats.activeConnections = Math.max(0, stats.activeConnections - 1); });
}

function handleProxyRequest(req, res) {
  const raw = new URL(req.url, 'http://localhost');
  const targetValue = raw.searchParams.get('url') || raw.searchParams.get('target') || (raw.pathname && raw.pathname !== '/' ? raw.pathname.slice(1) : '');
  if (!targetValue) {
    renderError(res, 'Missing target', 'No URL was supplied.', 'Use ?url=https://example.com');
    return;
  }

  try {
    const target = sanitizeTarget(targetValue);
    if (target.protocol === 'ws:' || target.protocol === 'wss:') {
      renderError(res, 'WebSocket route', 'Use the WebSocket upgrade handler.', '');
      return;
    }
    proxyHttpRequest(target.toString(), req, res);
  } catch (err) {
    addError(err, 'Proxy target resolution');
    renderError(res, 'Invalid target', 'The URL could not be parsed safely.', err.message || 'Unknown error');
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

  if (url.pathname === '/__oldage_admin') {
    renderAdminDashboard(res, req);
    return;
  }

  if (url.pathname === '/' && !url.searchParams.has('url') && !url.searchParams.has('target')) {
    renderHomePage(res);
    return;
  }

  handleProxyRequest(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const raw = new URL(req.url, 'http://localhost');
  const targetValue = raw.searchParams.get('url') || raw.searchParams.get('target') || (raw.pathname && raw.pathname !== '/' ? raw.pathname.slice(1) : '');
  if (!targetValue) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const target = sanitizeTarget(targetValue);
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
  console.log(`old age is live on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/__oldage_admin?key=${ADMIN_KEY}`);
  console.log('Use: /?url=https://example.com');
});
