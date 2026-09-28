import { existsSync, readFileSync, readdirSync } from 'node:fs';

const forbidden = [];
const files = readdirSync(process.cwd()).filter((name) => name.startsWith('.env') && existsSync(name));

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    const key = match?.[1];
    if (key && /^(VITE_|NEXT_PUBLIC_)/.test(key) && /(KEY|SECRET|TOKEN|OPENROUTER|INSFORGE|ASSEMBLYAI)/i.test(key)) {
      forbidden.push(`${file}:${index + 1} ${key}`);
    }
  }
}

if (forbidden.length > 0) {
  console.error('Variables sensibles expuestas al navegador detectadas:\n' + forbidden.join('\n'));
  process.exit(1);
}
