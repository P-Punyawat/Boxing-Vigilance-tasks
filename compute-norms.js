#!/usr/bin/env node
// Fetches normative stats from the deployed Apps Script and writes norms.json.
// Usage:  node compute-norms.js <WEB_APP_URL>
'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const rawUrl = process.argv[2];
if (!rawUrl) {
  console.error('Usage: node compute-norms.js <WEB_APP_URL>');
  process.exit(1);
}

const url = new URL(rawUrl);
url.searchParams.set('action', 'norms');

function get(urlStr, cb) {
  const mod = urlStr.startsWith('https') ? https : http;
  mod.get(urlStr, { headers: { 'User-Agent': 'compute-norms/1.0' } }, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return get(res.headers.location, cb);
    }
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => cb(null, body));
  }).on('error', cb);
}

get(url.toString(), (err, body) => {
  if (err) { console.error('Request failed:', err.message); process.exit(1); }

  let norms;
  try { norms = JSON.parse(body); } catch (e) {
    console.error('Could not parse response:\n', body);
    process.exit(1);
  }

  if (norms.error) { console.error('Script error:', norms.error); process.exit(1); }

  if (norms._n) {
    const n = norms._n;
    console.log(`Normative sample — SART: n=${n.sart}  BART: n=${n.bart}  MOT: n=${n.mot}`);
  }

  const outPath = path.join(__dirname, 'norms.json');
  fs.writeFileSync(outPath, JSON.stringify(norms, null, 2) + '\n');
  console.log('Written:', outPath);
});
