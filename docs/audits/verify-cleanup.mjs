import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/audits/protected-files.json'), 'utf8'));
const differences = Object.entries(manifest.files).filter(([file, hash]) => {
  const target = path.join(root, file);
  return !fs.existsSync(target) || crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== hash;
}).map(([file]) => file);
const excluded = new Set(['node_modules', '.git', '.vercel', '.insforge', '.worktrees', 'tmp', 'dist', '.agents', '.agent', '.serena', '.impeccable', '.superpowers']);
function markdown(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    if (excluded.has(item.name) || item.name.startsWith('.aider')) return [];
    const full = path.join(directory, item.name);
    return item.isDirectory() ? markdown(full) : item.name.endsWith('.md') ? [full] : [];
  });
}
const broken = [];
for (const file of markdown(root)) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (relative.startsWith('policy/') || relative === 'docs/brain/repo-map.md') continue;
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|mailto:|codex:|#)/.test(link)) continue;
    const destination = link.split('#')[0];
    if (!destination || /[<> ]/.test(destination)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), decodeURI(destination)))) broken.push({ file: relative, destination });
  }
}
console.log(JSON.stringify({ protectedFiles: Object.keys(manifest.files).length, differences, brokenLinks: broken }, null, 2));
if (differences.length || broken.length) process.exitCode = 1;
