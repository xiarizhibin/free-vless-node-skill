#!/usr/bin/env node
// Level-1 verification: speaks the relay preamble over WS, then runs a REAL TLS
// handshake on the same stream and fetches an HTTPS page through it.
//
// This is the test that catches the two classic server bugs:
//   * missing / misplaced response header  -> "relay header: 4854 (HT)  (WRONG)"
//   * preamble parsed twice                -> header shows up twice, TLS breaks
//
// usage: node verify-tls.mjs wss://HOST/ [target-host] [target-port] [--key HEX]
// exit 0 = TLS handshake + HTTPS page OK (real clients will connect)

import tls from 'node:tls';
import { Duplex } from 'node:stream';

const argv = process.argv.slice(2);
const opts = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opts[k] = v;
  } else {
    pos.push(argv[i]);
  }
}

const KEY = String(opts.key || process.env.RELAY_KEY || 'a8f3c1e2-5b7d-4e9a-9c1f-2d6b8e4a7c30');
const WSS = pos[0] || 'wss://127.0.0.1:8080/';
const HOST = pos[1] || 'www.cloudflare.com';
const PORT = Number(pos[2] || 443);
const PATH = String(opts.path || '/cdn-cgi/trace');

if (!/^wss?:\/\//.test(WSS)) {
  console.error('first argument must be a ws:// or wss:// URL');
  process.exit(2);
}
const hex = KEY.replace(/-/g, '');
if (hex.length !== 32 || /[^0-9a-f]/i.test(hex)) {
  console.error('key must be 32 hex chars (uuid without dashes)');
  process.exit(2);
}

const id = Buffer.from(hex, 'hex');
const hb = Buffer.from(HOST, 'utf8');
const head = Buffer.alloc(1 + 16 + 1 + 1 + 2 + 2 + hb.length);
let p = 0;
head[p++] = 0x00;
id.copy(head, p); p += 16;
head[p++] = 0x00;
head[p++] = 0x01;
head.writeUInt16BE(PORT, p); p += 2;
head[p++] = 0x02;
head[p++] = hb.length;
hb.copy(head, p);

const ws = new WebSocket(WSS);
ws.binaryType = 'arraybuffer';

let buf = Buffer.alloc(0);
let stream = null;
let headerSeen = false;

class WsStream extends Duplex {
  constructor(sock) { super(); this.sock = sock; }
  _read() {}
  _write(chunk, enc, cb) {
    try { this.sock.send(chunk); } catch (e) { /* closed */ }
    cb();
  }
}

ws.onopen = () => ws.send(new Uint8Array(head));
ws.onerror = (e) => {
  console.log('WS ERROR: ' + (e.message || e.type));
  process.exit(1);
};

ws.onmessage = (ev) => {
  buf = Buffer.concat([buf, Buffer.from(ev.data)]);

  if (!headerSeen) {
    if (buf.length < 2) return;
    headerSeen = true;
    const hdr = buf.subarray(0, 2).toString('hex');
    if (hdr !== '0000') {
      const peek = buf.subarray(0, 24).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      console.log('relay header: ' + hdr + '  (WRONG, expected 0000)');
      console.log('  first bytes look like: ' + JSON.stringify(peek));
      console.log('  -> server relays upstream bytes before the response header (template pitfall 1)');
      process.exit(1);
    }
    console.log('relay header: 0000  (OK)');
    buf = buf.subarray(2);
    stream = new WsStream(ws);
    startTls();
  }

  if (stream && buf.length) {
    const out = buf;
    buf = Buffer.alloc(0);
    stream.push(out);
  }
};

function startTls() {
  const s = tls.connect(
    { socket: stream, servername: HOST, ALPNProtocols: ['http/1.1'] },
    () => {
      console.log('TLS handshake OK: ' + s.getProtocol() + ' / ' + s.getCipher().name);
      s.write(
        'GET ' + PATH + ' HTTP/1.1\r\nHost: ' + HOST +
        '\r\nConnection: close\r\nUser-Agent: verify-tls\r\n\r\n'
      );
    }
  );

  let seen = '';
  s.on('data', (d) => {
    seen += d.toString();
    const m = seen.match(/ip=([^\r\n]+)/);
    if (m) {
      console.log('HTTP through TLS: ip=' + m[1]);
      console.log('RESULT: OK - TLS-through-relay works (real clients will connect)');
      process.exit(0);
    }
  });
  s.on('error', (e) => {
    console.log('TLS ERROR: ' + String(e.message).split('\n')[0]);
    if (/wrong version/.test(e.message)) {
      console.log('  -> upstream bytes are polluted: duplicate response header or double-streamed preamble (template pitfall 2)');
    }
    process.exit(1);
  });
}

setTimeout(() => {
  console.log('TIMEOUT (25s) - no data; check platform wake-up / outbound rules');
  process.exit(1);
}, 25000);
