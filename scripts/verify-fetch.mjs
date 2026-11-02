#!/usr/bin/env node
// Level-2 probe: plaintext HTTP through the relay. Prints the raw first bytes and
// the status line. Useful to see whether bytes flow at all.
//
// WARNING: this test PASSES on a node that is broken for real clients (a missing
// response header does not stop a plaintext response from arriving). Use
// verify-tls.mjs for the pass/fail decision.
//
// usage: node verify-fetch.mjs wss://HOST/ [target-host] [target-port] [path] [--key HEX]

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
const WSS = pos[0];
const HOST = pos[1] || 'ip.sb';
const PORT = Number(pos[2] || 80);
const PATH = pos[3] || '/';

if (!WSS || !/^wss?:\/\//.test(WSS)) {
  console.error('usage: node verify-fetch.mjs wss://HOST/ [target-host] [target-port] [path]');
  process.exit(2);
}

const id = Buffer.from(KEY.replace(/-/g, ''), 'hex');
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

const req = Buffer.from(
  'GET ' + PATH + ' HTTP/1.1\r\nHost: ' + HOST +
  '\r\nConnection: close\r\nUser-Agent: verify-fetch\r\nAccept: */*\r\n\r\n',
  'utf8'
);

const ws = new WebSocket(WSS);
ws.binaryType = 'arraybuffer';
const t0 = Date.now();
const chunks = [];

ws.onopen = () => {
  ws.send(new Uint8Array(head));
  ws.send(new Uint8Array(req));
};

ws.onmessage = (ev) => {
  chunks.push(Buffer.from(ev.data));
  const all = Buffer.concat(chunks);
  const s = all.toString('utf8');
  const m = s.match(/HTTP\/1\.[01] (\d{3})/);
  if (m && s.includes('\r\n\r\n')) {
    console.log('raw head: ' + all.subarray(0, 4).toString('hex') +
      '   (0000 then "HTTP" = response header present)');
    console.log('status: ' + m[1] + '  bytes=' + all.length + '  ' + (Date.now() - t0) + 'ms');
    const body = s.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    console.log('body: ' + JSON.stringify(body.slice(0, 200)));
    process.exit(0);
  }
};

ws.onerror = (e) => { console.log('WS ERROR: ' + (e.message || e.type)); process.exit(1); };
ws.onclose = (e) => {
  const all = Buffer.concat(chunks);
  console.log('closed code=' + e.code + ' bytes=' + all.length);
  if (all.length) console.log('body: ' + JSON.stringify(all.toString('utf8').slice(0, 200)));
  process.exit(all.length ? 0 : 1);
};

setTimeout(() => { console.log('TIMEOUT (30s)'); process.exit(1); }, 30000);
