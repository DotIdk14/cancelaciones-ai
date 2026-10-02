# Plan de trabajo — Dashboard de auditoría (rama `dashboard/verify`)

Worktree aislado: `.worktrees/dashboard` (rama propia, `node_modules` propio).
Servidor de desarrollo: **http://localhost:5173** (Vite + `/api` local, InsForge real).

> Bloqueo conocido: no hay navegador de escritorio conectado a la sesión, así que
> la **verificación visual** la hace la persona usuaria. Lo que sí se automatiza:
> typecheck, tests, build, contraste WCAG y contratos de API.

## Hecho y verificado

| # | Tarea | Estado | Evidencia |
|---|---|---|---|
| 0 | Reparar `node_modules` corrupto (crash del host) | ✅ | `corrupt=0` tras reinstalar `recharts` + `lucide-react` |
| 0 | Aislar rama propia (sesión concurrente) | ✅ | worktree `dashboard/verify` en `a0fbf12` |
| 0 | Credenciales de InsForge + link del proyecto | ✅ | 4 endpoints `200` con datos reales |
| 0 | Migración `audit_dashboard_metrics` | ✅ ya aplicada | `20260929040000`, vista `relkind='v'`, 28 filas / 12 casos |
| 1 | Baseline: typecheck / tests / build | ✅ | 242 tests, build OK |
| 2 | `CaseListPage` ya no duplica el alta (M5) | ✅ | `src/components/CaseListPage.tsx` |
| 3 | Exports muertos eliminados (M6) | ✅ | `goHome`, `goToQuality`, `goToAiCosts`, `goToDashboard`, `goToNewCase`, `navigate`, `EMPTY_KPI`, `DashboardEndpoint`, `CONFIDENCE_THRESHOLDS` |
| 4 | Filtro `result` honesto en IA & Costos (M3) | ✅ | prop `allowResultFilter` |
| 5 | Tests de capa DB, filtros y rutas (M7) | ✅ | `dashboard-db`, `DashboardFilters`, `hash-route` (+44 tests) |
| 6 | Sanitizar URLs en errores de proveedor | ✅ | `src/server/http.ts` + test |
| 7 | Contraste WCAG AA en toda la paleta | ✅ | `--text-muted` #6f7a86 → #7d8894 (4.04:1 → 4.90:1) |
| 8 | Docs: migración, dashboard, CSP | ✅ | `README.md`, `AGENTS.md`, `docs/setup/insforge.md` |
| 9 | `verify:release` completo | ✅ | exit 0 |
| 10 | Ancho del shell unificado (header/nav/main) | ✅ | `src/lib/layout.ts` + `tabIndex={-1}` |
| 11 | Skip link: ya no expulsa al dashboard | ✅ | `preventDefault` + `focus()` |
| 12 | A11y B1: alternativas textuales en las 2 gráficas ciegas | ✅ | `EvolutionChart`, `ResultsBreakdownChart` |
| 13 | A11y B2: `role="img"` eliminado (destruía el teclado de Recharts) | ✅ | `title`/`desc` en el `<svg>` |
| 14 | A11y S3: estados de carga/vacío anunciados | ✅ | `ChartFrame`, `StatCard`, `EmptyState` |
| 15 | A11y S4/S5/S6: Label in Name, `scope="row"`, scrollers | ✅ | `AiCostsPage`, `RecentCasesTable`, `DataTable` |
| 16 | Perf: debounce eliminado en el primer montaje | ✅ | −250 ms en las 3 pantallas |
| 17 | Perf: los charts ya no se desmontan a la primera tecla | ✅ | `showSkeleton = isLoading && data === null` |
| 18 | Perf: chunk nombrado `recharts` (no `chartTheme`) | ✅ | entry 285.8 → 266.9 kB |
| 19 | Seg: minimización de datos (sin PII en 2 vistas) | ✅ | `AI_COSTS_COLUMNS`, `AI_QUALITY_COLUMNS` |
| 20 | Seg: `Cache-Control: no-store` en JSON con PII | ✅ | `src/server/http.ts` |
| 21 | Corrección: "Casos recientes" ya no muestra los antiguos | ✅ | `order(..., ascending: false)` |
| 22 | Suite final: 246 tests, typecheck, build, contrast | ✅ | todo verde |

| 23 | Métricas técnicas + coincidencia + coste en el Resumen | ✅ | datos reales: 12/3/10/2/$0.6377/$0.0531 |
| 24 | Los 6 filtros de dimensión, combinables, con valores reales | ✅ | `values: []` → la UI los oculta |
| 25 | Migración `20260930120000` aplicada y verificada (12 checks) | ✅ | 31 columnas, FK a `audits` |
| 26 | Revisión humana: tabla, endpoint, panel, flujo probado | ✅ | 1 revisión real, 0 % sobre 1 |
| 27 | Suite final: 282 tests, typecheck, build, contraste | ✅ | `verify:release` exit 0 |

## Pendiente

| # | Tarea | Responsable | Estado |
|---|---|---|---|
| 28 | Verificación visual por la persona usuaria | usuario | ⏸️ |
| 29 | Activar Vercel Deployment Protection (sin auth en `/api/*`) | usuario | ⏸️ |

## Hallazgos que NO se corrigen aquí, y por qué

- **Sin autenticación en `/api/*` (A01, CWE-306).** Es una decisión de diseño
  preexistente y documentada ("sin login" en AGENTS.md), no algo que introdujo el
  dashboard. Corregirlo exige añadir sesiones a toda la app, no a tres rutas.
  **Mitigación recomendada y barata: Vercel Deployment Protection**, que lo baja
  de High a Low sin tocar TypeScript. Nota: la RLS por `created_by` hoy es
  decorativa, porque todo el tráfico usa la clave admin (`BYPASSRLS`).
- **Rate limiting ausente.** Misma raíz: el punto de choke natural es
  `handleRoute` en `src/server/http.ts`, pero es una decisión de producto.
- **`COMMENT ON VIEW` que decía "no contiene datos sensibles".** Era falso
  (incluye `student_identifier`). Corregirlo exige una migración nueva; la vista
  es de la rama anterior y ya está aplicada.
- **Recharts pesa 392 kB.** Es la capa Redux/Immer de Recharts 3, no shakeable.
  Solo se descarga al abrir el dashboard y queda cacheado por hash. No se
  reescriben 6 gráficas a SVG para ahorrar 110 kB gzip a un equipo interno.

## Fuera de alcance

- **No desplegar a Vercel.** Separa hasta aprobación visual explícita.
- No tocar `src/skills/audit/{schema,types}.ts`: otra sesión de OpenCode trabaja
  ahí (`cycle-start-date-fix`) y rompe `typecheck` a propósito.
- M4 (agregar en Node en vez de SQL) se acepta tal cual: 5000 filas como tope
  es aceptable y moverlo a SQL es otro proyecto.
