// Dev tool: dump page-1 value cells (clip rects) + hex text runs from the raw content stream
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(new URL('../../../templates/Dictamen.pdf', import.meta.url));
const bytes = readFileSync(templatePath);
const src = bytes.toString('latin1');

// Parse objects
const objs = new Map();
const reObj = /(\d+)\s+(\d+)\s+obj/g;
let m;
while ((m = reObj.exec(src))) {
  const num = Number(m[1]);
  const start = reObj.lastIndex;
  const end = src.indexOf('endobj', start);
  if (end === -1) break;
  objs.set(num, src.slice(start, end));
}
console.log('objetos parseados:', objs.size);

function findPage1Contents() {
  for (let i = 1; i < 400; i += 1) {
    const body = objs.get(i);
    if (!body) continue;
    if (/\/Type\s*\/Page\b/.test(body) && !/\/Type\s*\/Pages\b/.test(body)) {
      const cm = body.match(/\/Contents\s+(\d+)\s+(\d+)\s+R/);
      if (cm) return { pageObj: i, contentsObj: Number(cm[1]) };
    }
  }
  return null;
}
const info = findPage1Contents();
if (!info) {
  for (const [num, body] of objs) {
    if (/\/Type\s*\/Page/.test(body)) console.log('PAGE CANDIDATE obj', num, body.slice(0, 120));
  }
  throw new Error('pagina 1 no encontrada');
}
console.log('page1 obj', info.pageObj, 'contents obj', info.contentsObj);

function streamOf(objNum) {
  const body = objs.get(objNum);
  if (!body) return null;
  const sm = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  if (!sm) return null;
  const raw = sm[1];
  // FlateDecode?
  if (/\/FlateDecode/.test(body)) {
    return inflateSync(Buffer.from(raw, 'binary')).toString('binary');
  }
  return raw;
}

const content = streamOf(info.contentsObj);
if (!content) throw new Error('stream no decodificado');
console.log('stream length:', content.length);

// Walk operators
const tokens = content.match(/(?:<<[\s\S]*?>>)|(?:\[[\s\S]*?\])|(?:\/[\w.]+)|(?:<[0-9A-Fa-f\s]*>)|(?:[A-Za-z*]+)|(?:-?\d+(?:\.\d+)?)/g) ?? [];
const t = tokens.map((x) => x.trim());
let i = 0;
let clip = null;
let curParams = [];
const runs = [];

function flushRun() {
  // curParams: [{hex, chars}] for text runs
  if (curParams.length === 0) return;
  runs.push({ clip: clip === null ? null : [...clip], text: curParams.join('') });
  curParams = [];
}

function value(v) {
  if (v.startsWith('<') && v.endsWith('>')) {
    const hex = v.slice(1, -1).replace(/\s+/g, '');
    return String.fromCharCode(...hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  }
  return v;
}

while (i < t.length) {
  const tok = t[i];
  if (tok === 'q' && t[i + 5] === 're' && t[i + 6] === 'W*' && t[i + 7] === 'n') {
    const X = Number(t[i + 1]);
    const Y = Number(t[i + 2]);
    const W = Number(t[i + 3]);
    const H = Number(t[i + 4]);
    clip = [X, Y, W, H];
    i += 8;
    continue;
  }
  if (tok === '[<') {
    // TJ array with hex strings
    i += 1;
    const parts = [];
    while (i < t.length && t[i] !== ']') {
      if (t[i].startsWith('<')) parts.push(value(t[i]));
      i += 1;
    }
    curParams.push(parts.join(''));
  } else if (tok.startsWith('<') && tok.endsWith('>') && t[i + 1] === 'Tj') {
    curParams.push(value(tok));
    i += 2;
    continue;
  } else if (tok === 'Tj' || tok === 'TJ') {
    // handled above
  } else if (tok === 'ET') {
    flushRun();
    clip = null;
  }
  i += 1;
}
flushRun();

for (const r of runs) {
  if (!r.clip) continue;
  const [X, Y, W, H] = r.clip;
  const yTopPdf = 842 - Y;
  const yBottomPdf = 842 - (Y + H);
  console.log(`${r.text.padEnd(28)} clip x=${X} y_abajo=${yBottomPdf.toFixed(1)} y_arriba=${yTopPdf.toFixed(1)} w=${W} h=${H}`);
}
if (runs.length === 0) console.log('(sin runs detectados) tokens:', t.length);
