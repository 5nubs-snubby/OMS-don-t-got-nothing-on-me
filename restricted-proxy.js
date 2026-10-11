const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROXY_NAME = 'old age';
const PROXY_TAGLINE = 'The overpowered proxy for anything on the internet';
const PORT = process.env.PORT || 3000;

function renderHome(res) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${PROXY_NAME}</title>
        <meta charset="utf-8" />
        <style>
          :root {
            --bg: #0f172a;
            --panel: #111827;
            --card: #1f2937;
            --accent: #8b5cf6;
            --accent-2: #22d3ee;
            --text: #e5e7eb;
            --muted: #9ca3af;
            --danger: #f87171;
          }

          * { box-sizing: border-box; }
          body {
            margin: 0;
            min-height: 100vh;
            font-family: Arial, sans-serif;
            background: radial-gradient(circle at top, #1e293b 0%, var(--bg) 48%, #020617 100%);
            color: var(--text);
            display: grid;
            place-items: center;
          }

          .shell {
            width: min(920px, 92vw);
            background: rgba(17, 24, 39, 0.9);
            border: 1px solid rgba(139, 92, 246, 0.45);
            box-shadow: 0 0 30px rgba(34, 211, 238, 0.18);
            border-radius: 18px;
            padding: 32px;
          }

          h1 {
            margin: 0 0 10px;
            font-size: clamp(2rem, 4vw, 3rem);
            letter-spacing: 0.05em;
            color: var(--accent-2);
          }

          .tagline {
            margin: 0 0 24px;
            color: var(--muted);
            font-size: 1.08rem;
          }

          .form-wrap {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 24px;
          }

          input {
            flex: 1 1 520px;
            min-width: 200px;
            padding: 14px 16px;
            border-radius: 12px;
            border: 1px solid rgba(148, 163, 184, 0.3);
            background: rgba(15, 23, 42, 0.9);
            color: var(--text);
            font-size: 1rem;
          }

          button {
            padding: 14px 20px;
            border: none;
            border-radius: 12px;
            background: linear-gradient(135deg, var(--accent), var(--accent-2));
            color: white;
            font-weight: 700;
            cursor: pointer;
            font-size: 1rem;
          }

          .cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
            margin-top: 16px;
          }

          .card {
            background: rgba(31, 41, 55, 0.95);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 12px;
            padding: 14px 18px;
          }

          .card strong { display: block; margin-bottom: 6px; color: #c4b5fd; }
          code {
            background: rgba(15, 23, 42, 0.8);
            color: #f9fafb;
            border-radius: 8px;
            padding: 2px 7px;
          }
        </style>
      </head>
      <body>
        <div class="shell">
          <h1>${PROXY_NAME}</h1>
          <p class="tagline">${PROXY_TAGLINE}</p>

          <form id="proxyForm" method="GET" action="/">
            <div class="form-wrap">
              <input
                id="targetUrl"
                name="url"
                type="text"
                placeholder="https://example.com"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="submit">Open</button>
            </div>
          </form>

          <div class="cards">
            <div class="card">
              <strong>Pattern</strong>
              <code>/https://example.com/path</code>
            </div>
            <div class="card">
              <strong>Query</strong>
              <code>/?url=https://example.com/path</code>
            </div>
            <div class="card">
              <strong>Methods</strong>
              <code>GET, POST, PUT, PATCH, DELETE</code>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderError(res, title, message, details = '') {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #111827;
            color: #f9fafb;
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
          }
          .box {
            width: min(680px, 90vw);
            background: #1f2937;
            border-left: 5px solid #f87171;
            border-radius: 12px;
            padding: 28px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          }
          h1 { margin-top: 0; color: #fca5a5; }
          p { line-height: 1.5; }
          .muted { color: #cbd5e1; }
          a {
            color: #67e8f9;
            text-decoration: none;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>${title}</h1>
          <p>${message}</p>
          <p class="muted">${details}</p>
          <p><a href="/">return to ${PROXY_NAME}</a></p>
        </div>
      </body>
    </html>
  `;

  res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sanitizeTarget(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    throw new Error('No target URL supplied.');
  }

  let cleaned = decodeURIComponent(rawInput.trim());
  if (!cleaned) {
    throw new Error('No target URL supplied.');
  }

  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  const url = new URL(cleaned);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https targets are supported.');
  }

  return url;
}

function proxyRequest(targetUrl, req, res) {
  const target = new URL(targetUrl);
  const transport = target.protocol === 'https:' ? https : http;

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers.connection;
  headers['x-forwarded-for'] = [headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');
  headers['x-forwarded-proto'] = target.protocol.replace(':', '');
  headers['x-forwarded-host'] = target.host;

  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}${target.hash}`,
    method: req.method,
    headers,
    timeout: 30000
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    delete responseHeaders['transfer-encoding'];
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Proxy Error</title></head>
        <body style="font-family:Arial,sans-serif; background:#111827; color:#f9fafb; padding:32px;">
          <h1>Proxy Error</h1>
          <p>${err.message}</p>
          <p><a href="/" style="color:#67e8f9;">back to ${PROXY_NAME}</a></p>
        </body>
      </html>
    `);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Gateway timed out'));
  });

  if (['GET', 'HEAD'].includes(req.method)) {
    proxyReq.end();
  } else {
    req.pipe(proxyReq);
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    renderError(res, 'Method not allowed', 'This proxy accepts standard HTTP methods, but not that one.', `Method: ${req.method}`);
    return;
  }

  const parsedUrl = new URL(req.url, 'http://localhost');

  if (parsedUrl.pathname === '/' && !parsedUrl.searchParams.has('url')) {
    renderHome(res);
    return;
  }

  let targetValue = parsedUrl.searchParams.get('url');

  if (!targetValue) {
    const rawPath = parsedUrl.pathname.replace(/^\//, '');
    targetValue = rawPath || '';
  }

  try {
    const target = sanitizeTarget(targetValue);
    proxyRequest(target.toString(), req, res);
  } catch (err) {
    renderError(res, 'Invalid proxy target', 'The target URL was malformed or unsupported.', err.message || 'Unknown error');
  }
});

server.listen(PORT, () => {
  console.log(`✅ ${PROXY_NAME} is listening on http://localhost:${PORT}`);
  console.log('💥 Example: http://localhost:3000/?url=https://example.com');
  console.log('🧠 Alternative: http://localhost:3000/https://example.com');
});
