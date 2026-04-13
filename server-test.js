const http = require('http');
const fs = require('fs');
const path = require('path');
const server = http.createServer((req, res) => {
  let fp = path.join(__dirname, 'public', req.url === '/' ? 'visual-test.html' : req.url);
  try {
    const data = fs.readFileSync(fp);
    const ext = path.extname(fp);
    const mimes = {'.html':'text/html','.css':'text/css','.js':'application/javascript'};
    res.writeHead(200, {'Content-Type': mimes[ext]||'text/plain'});
    res.end(data);
  } catch(e) { res.writeHead(404); res.end(''); }
});
server.listen(4567, '0.0.0.0', () => {
  process.stdout.write('READY\n');
});
