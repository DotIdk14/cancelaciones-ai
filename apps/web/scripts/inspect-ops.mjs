import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const templatePath = fileURLToPath(new URL('../../../templates/Dictamen.pdf', import.meta.url));
const bytes = readFileSync(templatePath);
const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
const pdf = await loadingTask.promise;
const page = await pdf.getPage(1);
const opList = await page.getOperatorList();
const names = new Map();
for (const fn of opList.fnArray) names.set(fn, (names.get(fn) ?? 0) + 1);
console.log([...names.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('\n'));
await loadingTask.destroy();
