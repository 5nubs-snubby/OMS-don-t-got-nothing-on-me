const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY_NAME = 'old age';
const ADMIN_KEY = process.env.ADMIN_KEY || 'old-age-admin';
const PORT = process.env.PORT || 3000;
const stats = {
  requests: 0,
  websockets: 0,
  lastTarget: null,
  startedAt: new Date().toISOString()
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

function renderAdminPage(res, req) {
  const url = new URL(req.url, 'http://localhost');
  const isValid = isAdminRequest(req);

  if (!isValid) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Unauthorized', message: 'Provide the admin key.' }, null, 2));
    return;
  }

  const payload = {
    ok: true,
    name: PROXY_NAME,
    adminKey: ADMIN_KEY,
    startedAt: stats.startedAt,
    stats,
    endpoints: {
      normal: '/?url=https://example.com',
      websocket: '/ws://example.com/path',
      admin: `/__oldage_admin?key=${ADMIN_KEY}`
    }
  };

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${PROXY_NAME} admin</title>
        <meta charset="utf-8" />
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            font-family: Arial, sans-serif;
            background: #020617;
            color: #e5e7eb;
            display: grid;
            place-items: center;
          }
          .box {
            width: min(860px, 92vw);
            background: #111827;
            border: 1px solid #22d3ee;
            border-radius: 18px;
            padding: 24px;
            box-shadow: 0 20px 60px rgba(34,211,238,0.2);
          }
          pre {
            white-space: pre-wrap;
            word-break: break-word;
            background: rgba(15, 23, 42, 0.7);
            padding: 18px;
            border-radius: 12px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>${PROXY_NAME} admin</h1>
          <p>Session key accepted.</p>
          <pre>${JSON.stringify(payload, null, 2)}</pre>
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
        <title>${PROXY_NAME}</title>
        <meta charset="utf-8" />
        <style>
          :root {
            --bg: #020617;
            --panel: #111827;
            --card: #1f2937;
            --accent: #8b5cf6;
            --accent-2: #22d3ee;
            --text: #e5e7eb;
            --muted: #94a3b8;
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            background: radial-gradient(circle at top, #111827 0%, var(--bg) 45%, #020617 100%);
            color: var(--text);
            font-family: Arial, sans-serif;
            display: grid;
            place-items: center;
          }
          .shell {
            width: min(960px, 92vw);
            background: rgba(17,24,39,0.9);
            border: 1px solid rgba(34,211,238,0.4);
            box-shadow: 0 0 30px rgba(139,92,246,0.22);
            border-radius: 18px;
            padding: 28px;
          }
          h1 {
            margin: 0 0 10px;
            font-size: clamp(2.1rem, 4vw, 3.5rem);
            letter-spacing: 0.08em;
            color: var(--accent-2);
          }
          .tag {
            color: var(--muted);
            margin-bottom: 24px;
          }
          .form-wrap {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 24px;
          }
          input {
            flex: 1 1 560px;
            min-width: 220px;
            background: rgba(15,23,42,0.9);
            border: 1px solid rgba(148,163,184,0.4);
            color: var(--text);
            font-size: 1rem;
            padding: 14px 16px;
            border-radius: 12px;
          }
          button {
            border: none;
            background: linear-gradient(135deg, var(--accent), var(--accent-2));
            color: white;
            padding: 14px 20px;
            font-weight: 700;
            border-radius: 12px;
            cursor: pointer;
            font-size: 1rem;
          }
          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
          }
          .card {
            background: rgba(31,41,55,0.85);
            border: 1px solid rgba(148,163,184,0.18);
            border-radius: 12px;
            padding: 16px;
          }
          .card strong {
            display: block;
            margin-bottom: 8px;
            color: #c4b5fd;
          }
          code {
            background: rgba(15,23,42,0.9);
            color: #f8fafc;
            border-radius: 8px;
            padding: 2px 7px;
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <h1>${PROXY_NAME}</h1>
          <div class="tag">The overpowered proxy for anything on the internet.</div>
          <form method="GET" action="/">
            <div class="form-wrap">
              <input type="text" name="url" placeholder="https://example.com" autocomplete="off" spellcheck="false" />
              <button type="submit">Open</button>
            </div>
          </form>
          <div class="grid">
            <div class="card"><strong>Pattern</strong><code>/https://example.com</code></div>
            <div class="card"><strong>Query</strong><code>/?url=https://example.com</code></div>
            <div class="card"><strong>Socket</strong><code>/ws://example.com/socket</code></div>
            <div class="card"><strong>Admin</strong><code>/__oldage_admin?key=${ADMIN_KEY}</code></div>
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
        <title>${title}</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            background: #111827;
            color: #f9fafb;
            display: grid;
            place-items: center;
            font-family: Arial, sans-serif;
          }
          .box {
            width: min(680px, 92vw);
            background: #1f2937;
            border-left: 6px solid #f87171;
            border-radius: 14px;
            padding: 28px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          h1 { margin-top: 0; color: #fca5a5; }
          a { color: #67e8f9; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>${title}</h1>
          <p>${message}</p>
          <p>${extra}</p>
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
    throw new Error('Only http, https, ws, and wss targets are allowed.');
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

function browserifyHeaders(req, target, isWebSocket = false) {
  const base = { ...req.headers };
  delete base.host;
  delete base.connection;
  delete base['content-length'];
  delete base['transfer-encoding'];
  delete base['upgrade'];
  delete base['x-forwarded-for'];
  delete base['x-forwarded-host'];
  delete base['x-forwarded-proto'];

  base['user-agent'] = base['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  base.accept = base.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
  base['accept-language'] = base['accept-language'] || 'en-US,en;q=0.9';
  base['accept-encoding'] = base['accept-encoding'] || 'gzip, deflate, br';
  base['upgrade-insecure-requests'] = base['upgrade-insecure-requests'] || '1';
  base['sec-fetch-mode'] = base['sec-fetch-mode'] || (isWebSocket ? 'websocket' : 'navigate');
  base['sec-fetch-site'] = base['sec-fetch-site'] || 'cross-site';
  base['sec-fetch-dest'] = base['sec-fetch-dest'] || (isWebSocket ? 'websocket' : 'document');
  base['cache-control'] = base['cache-control'] || 'no-cache';
  base['pragma'] = base['pragma'] || 'no-cache';
  base.origin = base.origin || target.origin;
  base.referer = base.referer || `${target.origin}/`;
  base['x-forwarded-for'] = [base['x-forwarded-for'], 'proxy'].filter(Boolean).join(', ');

  return base;
}

function rewriteResponseHeaders(headers = {}) {
  const out = { ...headers };
  out['X-Proxy-By'] = PROXY_NAME;
  out['Access-Control-Allow-Origin'] = '*';
  out['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
  out['Access-Control-Allow-Headers'] = '*';
  out['Access-Control-Expose-Headers'] = '*';
  delete out['content-security-policy'];
  delete out['content-security-policy-report-only'];
  delete out['x-frame-options'];
  delete out['x-content-type-options'];
  delete out['cross-origin-opener-policy'];
  delete out['cross-origin-resource-policy'];
  delete out['permissions-policy'];
  delete out['server'];
  return out;
}

function proxyHttpRequest(targetUrl, req, res) {
  const target = new URL(targetUrl);
  const transport = target.protocol === 'https:' || target.protocol === 'wss:' ? https : http;
  const headers = browserifyHeaders(req, target, false);
  headers.host = target.host;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}${target.hash}`,
    method: req.method,
    headers,
    timeout: 30000
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const responseHeaders = rewriteResponseHeaders(stripHopByHop(proxyRes.headers));
    res.writeHead(proxyRes.statusCode, responseHeaders);
    if (req.method === 'HEAD') {
      proxyRes.resume();
      return;
    }
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    renderError(res, 'Proxy error', 'The upstream request failed.', err.message || 'Unknown proxy problem');
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Request timed out.'));
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
  const upstream = (isSecure ? tls : net).connect({
    host: target.hostname,
    port: target.port || (isSecure ? 443 : 80),
    servername: target.hostname
  }, () => {
    const key = req.headers['sec-websocket-key'];
    const headers = {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Accept': key ? crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') : '',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Protocol': req.headers['sec-websocket-protocol'] || 'chat',
      Origin: req.headers.origin || 'http://localhost'
    };

    const request = [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${key}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: ${req.headers.origin || target.origin}`
    ];

    if (req.headers['sec-websocket-protocol']) {
      request.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    }

    if (req.headers['sec-websocket-extensions']) {
      request.push(`Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}`);
    }

    request.push('', '');
    upstream.write(request.join('\r\n'));

    if (head && head.length) {
      upstream.write(head);
    }
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

        if (remaining.length) {
          socket.write(remaining);
        }
      } else {
        socket.end(Buffer.from(rawHeaders));
        upstream.destroy();
        return;
      }
    } else {
      socket.write(chunk);
    }
  });

  socket.on('data', (chunk) => {
    if (handshakeCompleted) {
      upstream.write(chunk);
    }
  });

  socket.on('close', () => upstream.destroy());
  socket.on('error', () => upstream.destroy());
  upstream.on('close', () => socket.end());
  upstream.on('error', () => socket.destroy());
}

function handleProxyRequest(req, res) {
  const rawTarget = resolveTargetFromRequest(req);
  if (!rawTarget) {
    renderError(res, 'Bad request', 'You need a target URL, such as ?', 'Example: /?url=https://example.com');
    return;
  }

  try {
    const target = sanitizeTarget(rawTarget);
    stats.requests += 1;
    stats.lastTarget = target.toString();

    if (target.protocol === 'ws:' || target.protocol === 'wss:') {
      renderError(res, 'WebSocket route', 'Use the WebSocket upgrade handler, not normal HTTP routing.', 'This proxy supports WebSocket upgrades via the upgrade event.');
      return;
    }

    proxyHttpRequest(target.toString(), req, res);
  } catch (err) {
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

  if (url.pathname === '/__oldage_admin') {
    renderAdminPage(res, req);
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

    stats.websockets += 1;
    stats.lastTarget = target.toString();
    proxyWebSocketRequest(target.toString(), req, socket, head);
  } catch (err) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`✅ ${PROXY_NAME} is listening on http://localhost:${PORT}`);
  console.log('🧠 Example: http://localhost:3000/?url=https://example.com');
  console.log('🔌 WebSockets: ws://localhost:3000/ws://example.com/socket');
  console.log(`🔐 Admin: http://localhost:${PORT}/__oldage_admin?key=${ADMIN_KEY}`);
});
