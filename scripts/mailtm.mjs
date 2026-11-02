#!/usr/bin/env node
// Disposable mailbox over the public mail.tm API (no signup, no API key).
//
//   node mailtm.mjs new                      create inbox, save .mailtm.json
//   node mailtm.mjs list                     show messages (id / seen / from / subject)
//   node mailtm.mjs read <id>                print one message body
//   node mailtm.mjs wait [--timeout 300] [--code] [--link]
//
// --code  print only the first 4-8 digit code (verification codes)
// --link  print only the first http(s) URL (activation links)

import fs from 'node:fs';
import path from 'node:path';

const STATE = path.join(process.cwd(), '.mailtm.json');
const API = 'https://api.mail.tm';

function flag(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

async function call(p, opts = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + p, { ...opts, headers });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) {
    const detail = body && body.detail ? body.detail : 'HTTP ' + res.status;
    throw new Error(p + ' -> ' + detail);
  }
  return body;
}

function load() {
  if (!fs.existsSync(STATE)) throw new Error('no inbox yet: run `node mailtm.mjs new`');
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}

async function cmdNew() {
  const doms = await call('/domains');
  const list = doms['hydra:member'] || [];
  if (!list.length) throw new Error('mail.tm returned no domains');
  const domain = list[0].domain;
  const address = 'node' + String(Math.floor(Math.random() * 90000) + 10000) + '@' + domain;
  const password = 'Node#' + Math.random().toString(36).slice(2, 12);
  const acc = await call('/accounts', { method: 'POST', body: JSON.stringify({ address, password }) });
  const tok = await call('/token', { method: 'POST', body: JSON.stringify({ address, password }) });
  fs.writeFileSync(STATE, JSON.stringify({ address, password, id: acc.id, token: tok.token }, null, 2));
  console.log('address: ' + address);
  console.log('id:      ' + acc.id);
  console.log('saved:   ' + STATE);
}

async function cmdList() {
  const s = load();
  const r = await call('/messages', {}, s.token);
  const items = r['hydra:member'] || [];
  if (!items.length) console.log('(no messages)');
  for (const m of items) {
    console.log(m.id + '  seen=' + m.seen + '  ' + m.from.address + '  ' + m.subject);
  }
}

async function cmdRead(id) {
  if (!id) throw new Error('usage: node mailtm.mjs read <id>');
  const s = load();
  const m = await call('/messages/' + id, {}, s.token);
  console.log('subject: ' + m.subject);
  console.log('from:    ' + (m.from && m.from.address));
  console.log('---');
  console.log(m.text || m.html || '(empty)');
}

async function cmdWait() {
  const s = load();
  const timeout = Number(flag('timeout', 300));
  const wantCode = flag('code', false) === true;
  const wantLink = flag('link', false) === true;
  const deadline = Date.now() + timeout * 1000;
  let last = null;
  while (Date.now() < deadline) {
    const r = await call('/messages', {}, s.token);
    const items = r['hydra:member'] || [];
    const fresh = items.find((m) => m.id !== last);
    if (fresh) {
      const m = await call('/messages/' + fresh.id, {}, s.token);
      const text = (m.text || '') + '\n' + (m.html || '');
      if (!wantCode && !wantLink) {
        console.log('subject: ' + m.subject);
        console.log(m.text || m.html || '(empty)');
        return;
      }
      if (wantCode) {
        const c = text.match(/(?<!\d)(\d{4,8})(?!\d)/);
        if (c) { console.log(c[1]); return; }
      }
      if (wantLink) {
        const u = text.match(/https?:\/\/[^\s"'<>]+/);
        if (u) { console.log(u[0]); return; }
      }
      last = fresh.id;
    }
    await new Promise((r2) => setTimeout(r2, 4000));
  }
  console.error('timeout: no matching message within ' + timeout + 's');
  process.exit(1);
}

const cmd = process.argv[2];
const table = { new: cmdNew, list: cmdList, read: () => cmdRead(process.argv[3]), wait: cmdWait };
const run = table[cmd];
if (!run) {
  console.log('usage: node mailtm.mjs new|list|read <id>|wait [--timeout 300] [--code] [--link]');
  process.exit(2);
}
run().catch((e) => { console.error('error: ' + e.message); process.exit(1); });
