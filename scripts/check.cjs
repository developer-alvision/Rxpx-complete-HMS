'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let failures = 0, checked = 0;
function check(source, filename) {
  try { new vm.Script(source, { filename }); checked++; }
  catch (error) { failures++; console.error(error.message + ' in ' + filename); }
}
for (const file of fs.readdirSync(path.join(root, 'js'))) {
  if (file.endsWith('.js')) check(fs.readFileSync(path.join(root, 'js', file), 'utf8'), 'js/' + file);
}
check(fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8'), 'functions/index.js');
if (fs.existsSync(path.join(root, 'functions/core.cjs'))) check(fs.readFileSync(path.join(root, 'functions/core.cjs'), 'utf8'), 'functions/core.cjs');
check(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), 'sw.js');
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(attrs) && !/application\/(?:ld\+)?json/.test(attrs) && body.trim()) check(body, file + ':inline');
  }
  for (const [, resource] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|data:|mailto:|tel:|#|javascript:)/.test(resource) || resource.includes('${')) continue;
    const local = resource.split(/[?#]/)[0];
    if (local && !fs.existsSync(path.join(root, local))) { failures++; console.error('Missing resource: ' + file + ' → ' + local); }
  }
}
for (const file of ['firebase.json', 'firestore.indexes.json', 'manifest.webmanifest', 'vercel.json']) JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
for (const entry of [...(manifest.shortcuts || []).map(s => s.url), ...(manifest.icons || []).map(i => i.src)]) {
  const local = String(entry || '').split(/[?#]/)[0];
  if (local && !fs.existsSync(path.join(root, local))) { failures++; console.error('Missing manifest asset: ' + local); }
}
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const shellMatch = swSource.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
if (shellMatch) {
  for (const [, item] of shellMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
    if (item === './') continue;
    if (!fs.existsSync(path.join(root, item))) { failures++; console.error('Missing service worker asset: ' + item); }
  }
}
console.log(`Checked ${checked} scripts and all page assets: ${failures} errors.`);
process.exitCode = failures ? 1 : 0;
