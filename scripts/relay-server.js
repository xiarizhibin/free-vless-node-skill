'use strict';

// Generic HTTP relay over a persistent WebSocket channel.
// Reads a small binary preamble, opens a TCP stream to the requested
// endpoint, then pipes bytes in both directions.

const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const KEY_HEX = (process.env.RELAY_KEY || 'a8f3c1e2-5b7d-4e9a-9c1f-2d6b8e4a7c30')
  .toLowerCase()
  .replace(/-/g, '');
const KEY = Buffer.from(KEY_HEX, 'hex');

const EVENTS = [];
const started = Date.now();
function note(e) {
  e.t = new Date().toISOString();
  EVENTS.push(e);
  if (EVENTS.length > 60) EVENTS.shift();
  try {
    console.log(JSON.stringify(e));
  } catch (_) {}
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/_status')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        {
          up: Math.round((Date.now() - started) / 1000),
          channels: EVENTS.filter((e) => e.kind === 'ws').length,
          accepted: EVENTS.filter((e) => e.ok).length,
          recent: EVENTS.slice(-25),
        },
        null,
        1
      )
    );
    return;
  }
  note({
    kind: 'http',
    path: url,
    ua: String(req.headers['user-agent'] || '').slice(0, 80),
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>relay</title>' +
    '<h3>relay service ok</h3>');
});

const wss = new WebSocketServer({ server, perMessageDeflate: false });

// preamble: [ver 1B][key 16B][extLen 1B][ext][op 1B][port 2B][atype 1B][addr][body...]
function readPreamble(buf) {
  if (buf.length < 18) return null;
  let p = 0;
  const ver = buf[p]; p += 1;
  const key = buf.subarray(p, p + 16); p += 16;
  if (!key.equals(KEY)) return { ok: false, why: 'bad-key', got: key.toString('hex') };
  const extLen = buf[p]; p += 1;
  if (buf.length < p + extLen + 1) return null;
  p += extLen;
  const op = buf[p]; p += 1;
  if (buf.length < p + 3) return null;
  const port = buf.readUInt16BE(p); p += 2;
  const kind = buf[p]; p += 1;
  let addr = '';
  if (kind === 1) {
    if (buf.length < p + 4) return null;
    addr = Array.from(buf.subarray(p, p + 4)).join('.');
    p += 4;
  } else if (kind === 2) {
    if (buf.length < p + 1) return null;
    const n = buf[p]; p += 1;
    if (buf.length < p + n) return null;
    addr = buf.subarray(p, p + n).toString('utf8');
    p += n;
  } else if (kind === 3) {
    if (buf.length < p + 16) return null;
    const seg = [];
    for (let i = 0; i < 8; i++) seg.push(buf.readUInt16BE(p + i * 2).toString(16));
    addr = seg.join(':');
    p += 16;
  } else {
    return { ok: false, why: 'bad-kind', kind };
  }
  return { ok: true, ver, op, port, addr, body: Buffer.from(buf.subarray(p)) };
}

wss.on('connection', (ws, req) => {
  const ev = {
    kind: 'ws',
    path: req.url,
    ua: String(req.headers['user-agent'] || '').slice(0, 80),
    ok: false,
    up: 0,
    down: 0,
  };
  note(ev);

  let pre = Buffer.alloc(0);
  let ready = false;
  let upstream = null;
  let queue = [];
  let closed = false;

  const stop = () => {
    if (closed) return;
    closed = true;
    if (upstream && !upstream.destroyed) upstream.destroy();
  };

  ws.on('message', (data) => {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
    ev.up += b.length;

    if (!ready) {
      pre = Buffer.concat([pre, b]);
      let r = null;
      try {
        r = readPreamble(pre);
      } catch (e) {
        ev.why = String(e.message);
        ws.close();
        return;
      }
      if (r === null) {
        if (pre.length > 4096) ws.close();
        return;
      }
      if (!r.ok) {
        ev.why = r.why;
        note({ kind: 'reject', why: r.why, got: r.got || r.kind });
        ws.close();
        return;
      }
      ev.ok = true;
      ev.target = r.addr + ':' + r.port;
      ev.op = r.op;
      ready = true;
      pre = Buffer.alloc(0);
      if (r.op !== 1) {
        ev.why = 'op-' + r.op;
        ws.close();
        return;
      }

      let announced = false;
      const onLink = () => {
        if (announced) return;
        announced = true;
        ev.linked = true;
        if (ws.readyState === 1) ws.send(Buffer.from([r.ver, 0]));
        if (r.body && r.body.length) upstream.write(r.body);
        for (const c of queue) upstream.write(c);
        queue = [];
      };
      upstream = net.connect({ host: r.addr, port: r.port });
      upstream.once('connect', onLink);
      upstream.once('ready', onLink);

      upstream.on('data', (d) => {
        ev.down += d.length;
        if (ws.readyState === 1) ws.send(d);
      });
      upstream.on('close', () => {
        try { ws.close(); } catch (e) {}
        stop();
      });
      upstream.on('error', (e) => {
        ev.why = 'link:' + (e.code || e.message);
        try { ws.close(); } catch (e2) {}
        stop();
      });
      return;
    }

    if (upstream && !upstream.destroyed) upstream.write(b);
    else if (queue.length < 64) queue.push(b);
  });

  ws.on('close', stop);
  ws.on('error', (e) => { ev.why = 'ws:' + (e.message || 'error'); stop(); });
});

setInterval(() => {
  wss.clients.forEach((c) => {
    if (c.readyState === 1) {
      try { c.ping(); } catch (e) {}
    }
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('relay listening on ' + PORT);
});
