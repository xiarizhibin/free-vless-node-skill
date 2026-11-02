#!/usr/bin/env node
// Build the share link, a single-node base64 subscription, and a QR code.
// The QR is decoded back and compared byte-for-byte with link.txt, so a wrong or
// truncated QR can never reach the user.
//
// usage:
//   node gen-link.mjs --host HOST --uuid UUID_OR_HEX [--port 443] [--path /]
//                     [--name My-Node] [--out ./out] [--fp chrome] [--no-qr]
//
// QR step needs: npm i jsqr pngjs   (skipped gracefully if missing / offline)

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    opts[k] = v;
  }
}

const HOST = opts.host;
const RAW_KEY = opts.uuid || opts.key;
if (!HOST || !RAW_KEY) {
  console.error('usage: node gen-link.mjs --host HOST --uuid UUID [--port 443] [--path /] [--name NAME] [--out DIR]');
  process.exit(2);
}

const PORT = String(opts.port || '443');
const WSPATH = String(opts.path || '/');
const NAME = String(opts.name || 'relay-node');
const OUT = String(opts.out || './out');
const FP = opts.fp === true ? '' : String(opts.fp || 'chrome');
const NO_QR = opts['no-qr'] === true;

const uuid = String(RAW_KEY).toLowerCase();
const uuidFmt = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
  ? uuid
  : uuid.replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuidFmt)) {
  console.error('uuid must be 32 hex chars or canonical uuid form');
  process.exit(2);
}

const encPath = encodeURIComponent(WSPATH);
const query =
  'encryption=none' +
  '&security=tls' +
  '&sni=' + HOST +
  '&type=ws' +
  '&host=' + HOST +
  '&path=' + encPath +
  '&alpn=http%2F1.1' +
  (FP ? '&fp=' + FP : '');

const link = 'vless://' + uuidFmt + '@' + HOST + ':' + PORT + '?' + query + '#' + encodeURIComponent(NAME);
const sub = Buffer.from(link, 'utf8').toString('base64');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'link.txt'), link);
fs.writeFileSync(path.join(OUT, 'sub-b64.txt'), sub);

console.log('link: ' + link);
console.log('sub:  ' + sub);
console.log('params: sni=' + HOST + ' host=' + HOST + ' path=' + encPath +
  ' port=' + PORT + ' tls=on alpn=http/1.1' + (FP ? ' fp=' + FP : ''));

if (NO_QR) process.exit(0);

let QR = null;
let PNG = null;
try {
  QR = (await import('jsqr')).default;
  PNG = (await import('pngjs')).PNG;
} catch (e) {
  console.log('\n[skip qr] jsqr/pngjs not installed: npm i jsqr pngjs');
  process.exit(0);
}

const outPng = path.join(OUT, 'qr.png');
const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=720x720&margin=16&data=' +
  encodeURIComponent(link);

https.get(qrUrl, (res) => {
  if (res.statusCode !== 200) {
    console.log('\n[qr] service returned ' + res.statusCode + ', skipping');
    process.exit(0);
  }
  const file = fs.createWriteStream(outPng);
  res.pipe(file);
  file.on('finish', () => {
    file.close(() => {
      const png = PNG.sync.read(fs.readFileSync(outPng));
      const got = QR(new Uint8ClampedArray(png.data), png.width, png.height);
      if (!got) {
        console.log('\n[qr] decoded nothing -> regenerate, do not ship this file');
        process.exit(1);
      }
      const match = got.data === link;
      console.log('\nqr: ' + outPng + '  (' + png.width + 'x' + png.height + ')');
      console.log('qr readback: ' + (match ? 'MATCH' : 'MISMATCH'));
      if (!match) {
        console.log('  decoded: ' + got.data);
        process.exit(1);
      }
    });
  });
}).on('error', (e) => {
  console.log('\n[qr] download failed: ' + e.message);
  process.exit(0);
});
