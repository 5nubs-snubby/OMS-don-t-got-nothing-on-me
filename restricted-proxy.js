const http = require('http');
const https = require('https');
const url = require('url');

// Only allowed domain
const ALLOWED_DOMAIN = 'startmyeducation.net';
const ALLOWED_DOMAINS = [ALLOWED_DOMAIN, `www.${ALLOWED_DOMAIN}`];

const server = http.createServer((req, res) => {
  // Home page
  if (req.url === '/' || req.url === '') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Start My Education - Proxy</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          h1 { color: #333; }
          .info {
            background-color: #e8f4f8;
            padding: 15px;
            border-left: 4px solid #2196F3;
            margin: 20px 0;
          }
          a {
            display: inline-block;
            margin-top: 15px;
            padding: 10px 20px;
            background-color: #2196F3;
            color: white;
            text-decoration: none;
            border-radius: 4px;
          }
          a:hover {
            background-color: #1976D2;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎓 Start My Education Proxy</h1>
          <div class="info">
            <strong>This proxy only allows access to startmyeducation.net</strong>
          </div>
          <p>Click the button below to access Start My Education:</p>
          <a href="/https://startmyeducation.net">Access startmyeducation.net</a>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // Extract target URL
  let targetUrl = decodeURIComponent(req.url.slice(1));

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>Error</h1><p>No URL provided</p>');
    return;
  }

  // Ensure protocol
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    const parsedUrl = url.parse(targetUrl);
    const hostname = parsedUrl.hostname;

    // Verify domain is allowed
    if (!ALLOWED_DOMAINS.includes(hostname)) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Access Denied</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              max-width: 600px;
              margin: 50px auto;
              padding: 20px;
            }
            .error {
              background-color: #ffebee;
              padding: 20px;
              border-left: 4px solid #f44336;
              border-radius: 4px;
            }
            h1 { color: #f44336; }
            a {
              display: inline-block;
              margin-top: 15px;
              padding: 10px 20px;
              background-color: #2196F3;
              color: white;
              text-decoration: none;
              border-radius: 4px;
            }
          </style>
        </head>
        <body>
          <div class="error">
            <h1>❌ Access Denied</h1>
            <p>This proxy only allows access to <strong>${ALLOWED_DOMAIN}</strong></p>
            <p>You tried to access: <strong>${hostname}</strong></p>
            <a href="/">Return to Home</a>
          </div>
        </body>
        </html>
      `);
      return;
    }

    // Proxy request to allowed domain
    proxyRequest(targetUrl, req, res);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid URL: ' + err.message);
  }
});

function proxyRequest(targetUrl, req, res) {
  const parsedUrl = url.parse(targetUrl);
  const protocol = parsedUrl.protocol === 'https:' ? https : http;

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: parsedUrl.path || '/',
    method: req.method,
    headers: {
      ...req.headers,
      host: parsedUrl.hostname
    },
    timeout: 15000
  };

  // Remove problematic headers
  delete options.headers['content-length'];

  const proxyReq = protocol.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Proxy Error</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
          }
          .error {
            background-color: #ffebee;
            padding: 20px;
            border-left: 4px solid #f44336;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>⚠️ Proxy Error</h1>
          <p>${err.message}</p>
          <a href="/">Return to Home</a>
        </div>
      </body>
      </html>
    `);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.writeHead(504, { 'Content-Type': 'text/html' });
    res.end('<h1>Gateway Timeout</h1><p>The request took too long to complete.</p>');
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Restricted proxy running on http://localhost:${PORT}`);
  console.log(`📝 Only allows access to: ${ALLOWED_DOMAIN}`);
  console.log(`🔗 Usage: http://localhost:${PORT}`);
});