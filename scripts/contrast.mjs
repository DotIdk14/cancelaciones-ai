// =============================================================================
// Contraste WCAG 2.2 de la paleta del dashboard (ratio >= 4.5:1 para texto
// normal, >= 3:1 para texto grande y bordes de componente).
//
// Es una herramienta de diseño, no un test: se ejecuta a mano cuando cambia un
// color. Los valores se leen de `src/index.css` y `src/lib/labels.ts`, así que
// no pueden quedar desincronizados con el tema.
// =============================================================================

import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');

/**
 * Extrae `--nombre: <color>;` del tema. Acepta `#rrggbb` y `rgba(...)`: el
 * borde se define con alfa, así que hay que componerlo sobre el fondo para
 * medir el color que el ojo ve realmente.
 */
function token(name) {
  // Acepta el nombre con o sin los guiones iniciales (`success` o `--success`).
  const bare = name.replace(/^--/, '');
  const match = css.match(new RegExp(`--${bare}:\\s*(#[0-9a-fA-F]{3,8}|rgba?\\([^)]*\\))`));
  if (!match) throw new Error(`No se encontró --${bare} en src/index.css`);
  return match[1];
}

/** Compone un color con alfa sobre un fondo opaco y devuelve `#rrggbb`. */
function flatten(color, backdrop) {
  if (color.startsWith('#')) return color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color.slice(0, 7);
  const [r, g, b, a = '1'] = color.match(/[\d.]+/g) ?? [];
  const alpha = Number(a);
  const under = toRgb(backdrop);
  const over = [r, g, b].map(Number);
  const mix = over.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Pares que la UI usa realmente, con el mínimo que le corresponde.
const PAIRS = [
  { fg: 'text-primary', bg: 'background', min: 4.5, uso: 'texto normal sobre el fondo' },
  { fg: 'text-primary', bg: 'surface-1', min: 4.5, uso: 'texto normal en panel' },
  { fg: 'text-primary', bg: 'surface-2', min: 4.5, uso: 'texto normal en control' },
  { fg: 'text-primary', bg: 'surface-3', min: 4.5, uso: 'texto normal en superficie elevada' },
  { fg: 'text-secondary', bg: 'background', min: 4.5, uso: 'texto secundario (muted)' },
  { fg: 'text-secondary', bg: 'surface-1', min: 4.5, uso: 'descripción en panel' },
  { fg: 'text-secondary', bg: 'surface-2', min: 4.5, uso: 'ayuda en control' },
  { fg: 'text-muted', bg: 'background', min: 4.5, uso: 'texto terciario' },
  { fg: 'text-muted', bg: 'surface-1', min: 4.5, uso: 'nota al pie de panel' },
  { fg: 'text-muted', bg: 'surface-2', min: 4.5, uso: 'metadato en tabla' },
  { fg: 'accent', bg: 'background', min: 4.5, uso: 'enlace/énfasis' },
  { fg: 'accent', bg: 'surface-1', min: 4.5, uso: 'énfasis en panel' },
  { fg: 'accent', bg: 'surface-2', min: 4.5, uso: 'foco y control' },
  { fg: 'success', bg: 'surface-1', min: 4.5, uso: 'badge de éxito' },
  { fg: 'warning', bg: 'surface-1', min: 4.5, uso: 'badge de aviso' },
  { fg: 'danger', bg: 'surface-1', min: 4.5, uso: 'badge de error' },
];

// 1.4.11 Non-text Contrast: un borde que delimita un control necesita 3:1, pero
// solo si es lo ÚNICO que lo delimita. Aquí los paneles y controles también
// se distinguen por su propio relleno (`surface-*`), así que el borde es
// decoración y se queda en 1.4.3. Se mide aparte para dejarlo documentado, no
// para exigir 3:1.
const DECORATIVOS = [
  { fg: 'border', bg: 'surface-1', uso: 'borde de panel (relleno también lo delimita)' },
  { fg: 'border', bg: 'background', uso: 'borde sobre el fondo' },
];

let failures = 0;
console.log('par                                  ratio   min   estado');
console.log('-'.repeat(64));
for (const { fg, bg, min, uso } of PAIRS) {
  const fondo = token(bg);
  const ratio = contrast(flatten(token(fg), fondo), fondo);
  const ok = ratio >= min;
  if (!ok) failures += 1;
  console.log(
    `${`${fg} sobre ${bg}`.padEnd(38)} ${ratio.toFixed(2).padStart(5)}  ${String(min).padStart(4)}   ${ok ? 'OK' : 'FALLA'}  (${uso})`,
  );
}

console.log('-'.repeat(64));
console.log('\ndecorativos (1.4.3, sin mínimo de 3:1):');
for (const { fg, bg, uso } of DECORATIVOS) {
  const fondo = token(bg);
  const ratio = contrast(flatten(token(fg), fondo), fondo);
  console.log(`${`${fg} sobre ${bg}`.padEnd(38)} ${ratio.toFixed(2).padStart(5)}          ${uso}`);
}

// Las series de las gráficas (`RESOLUTION_GROUP_CHART_COLOR`) se leen como
// texto en la leyenda y en el tooltip, así que también deben llegar a 4.5:1
// sobre la superficie del panel. Se resuelven las variables CSS que usan.
console.log('\nseries de gráficas (leyenda y tooltip, mínimo 4.5):');
const seriesColors = readFileSync('src/lib/labels.ts', 'utf8').match(
  /RESOLUTION_GROUP_CHART_COLOR[\s\S]*?\n};/,
)?.[0] ?? '';
const series = [...seriesColors.matchAll(/(\w+):\s*'var\((--[\w-]+)\)'/g)];
for (const [, grupo, variable] of series) {
  const fondo = token('surface-1');
  const ratio = contrast(flatten(token(variable), fondo), fondo);
  const ok = ratio >= 4.5;
  if (!ok) failures += 1;
  console.log(
    `${`${variable} (${grupo})`.padEnd(38)} ${ratio.toFixed(2).padStart(5)}   4.5   ${ok ? 'OK' : 'FALLA'}`,
  );
}

console.log('\n' + '-'.repeat(64));
console.log(failures === 0 ? 'Todos los pares de TEXTO cumplen WCAG 2.2 AA.' : `${failures} par(es) de texto por debajo de 4.5:1.`);
process.exit(failures === 0 ? 0 : 1);
