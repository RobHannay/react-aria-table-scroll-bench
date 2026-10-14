// Minimal static server: GET /<arm>/... serves builds/<arm>/...
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('builds');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
export function serve(port = 4789) {
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, p);
        if (!file.startsWith(root) || !fs.existsSync(file)) return res.writeHead(404).end();
        res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((r) => server.listen(port, () => r(server)));
}
