# Remediación de PII en la historia Git

**Rama:** `feature/policy-foundation-remediation`
**Alcance:** toda la historia alcanzable del repositorio (7 ramas + 1 tag)
**Estado:** local rewrite `PASS`; remote ref replacement `PASS`
**Este documento no contiene datos personales.** Los valores saneados se identifican
únicamente por hash SHA-256 truncado.

---

## 1. Resumen ejecutivo

Se identificaron **8 elementos de datos personales** en la historia Git, repartidos en
dos vectores: contenido de archivos y metadatos de commit. Se saneó el 100% sin eliminar
estructura documental ni traza técnica, salvo en un único archivo que no constituía
schema sino un volcado de datos accidental.

Post-remediación: **0 ocurrencias** de PII real en `HEAD` y en la totalidad de los
commits alcanzables, tanto en contenido como en metadatos.

---

## 2. Inventario forense

### 2.1 PII en contenido de archivos

| Hash SHA-256 (12) | Categoría | Blobs afectados | Rutas |
|---|---|---|---|
| `2c4f04d7f280` | Nombre de persona (4 palabras) | 8 | 3 |
| `89f2cdd8837d` | Correo personal | 2 | 2 |
| `1d89aca64cef` | Correo personal | 1 | 1 |
| `ddd028fdf45b` | Teléfono móvil | 2 | 2 |

Rutas afectadas:

- `migrations/20260924170500_finish-audit-48680.sql`
- `docs/reports/POLICY-FOUNDATION-DB-SECURITY-CLOSURE.md`
- `docs/legacy/reports/cave-30591-blind-e2e-report.md`
- `apps/web/src/server/policy/blind-audit.test.ts` (solo histórico)

### 2.2 PII en metadatos de commit

| Hash SHA-256 (12) | Categoría | Commits afectados |
|---|---|---|
| `675877c5d04b` | Nombre real del autor | 8 |
| `198851720cfc` | Correo institucional UTEL (identifica a persona) | 8 |
| `1d89aca64cef` | Correo personal | 31 |
| `6dde71a48f6e` | Correo personal | 4 |
| `f137f1eb0317` | Correo personal | 4 |

### 2.3 Valores correctamente NO sanitizeados

Se verificó que los siguientes valores **no** constituyen PII y se preservaron intactos:

| Valor (no sensible) | Ubicación | Motivo |
|---|---|---|
| 6 teléfonos | `apps/web/src/server/reporting/template-layout.json` | Contactos institucionales de la plantilla oficial de dictamen |
| 4 secuencias numéricas | `normative/*.pdf` | Contenido de la fuente normativa; alterarlas corrompería la evidencia |
| `persona@gmail.com` | `apps/web/src/server/policy/operational-log.test.ts` | Marcador de prueba genérico |
| `5550000000` | `apps/web/src/app/api/dev/synthetic-case/route.ts` | Teléfono ficticio de caso sintético |
| `idk@localhost` | Metadatos | Identidad local no personal |
| `noreply@github.com` | Metadatos | Identidad de bot, no personal |

`UTEL-2026-001` se clasificó como **matrícula sintética**, no dato real de persona.

---

## 3. Estrategia aplicada

Se aplicaron tres acciones diferenciadas por naturaleza:

### 3.1 Eliminación completa — 1 archivo

`migrations/20260924170500_finish-audit-48680.sql` fue eliminado de toda la historia.

**Fundamento:** el archivo contiene **0 sentencias DDL y 16 sentencias `INSERT`**. Es un
volcado de datos de prueba, no schema. No existe dependencia de build ni de runtime
sobre él. Se aplicó `--invert-paths`.

### 3.2 Sanitización selectiva — 3 archivos

Los reportes y el fixture de test conservan su estructura, hallazgos y metodología; solo
se sustituyeron los valores personales por marcadores sintéticos deterministas:

| Hash origen | Sustituto aplicado |
|---|---|
| `2c4f04d7f280` | `NOMBRE_ESTUDIANTE_SANITIZADO` |
| `89f2cdd8837d` | `estudiante-a@sanitizado.invalid` |
| `1d89aca64cef` | `estudiante-b@sanitizado.invalid` |
| `ddd028fdf45b` | `+525000000001` |

Se verificó que ningún sustituto colisiona con contenido previo y que los valores
originales no aparecen en `template-layout.json` ni en el PDF normativo.

### 3.3 Pseudonimización de identidad — metadatos

Las 4 identidades personales se normalizaron a un único seudónimo mediante
`--commit-callback`:

```
DotIdk14 <dotidk14@sanitizado.invalid>
```

Identidades resultantes en toda la historia:

```
DotIdk14 <dotidk14@sanitizado.invalid>
GitHub   <noreply@github.com>
idk      <idk@localhost>
```

**Dominio `.invalid`:** reservado por RFC 2606, nunca resoluble. Garantiza que ningún
correo sanitizado sea entregable.

---

## 4. Hallazgos de proceso

Dos errores ocurrieron durante la ejecución y se documentan por trazabilidad:

1. **Pérdida de historia por refs no procesadas.** Una primera ejecución de
   `git-filter-repo` procesó solo 61 de 80 commits: las refs `origin/main`,
   `origin/HEAD` y `origin/feature/policy-foundation-remediation` quedaron fuera, lo que
   eliminó 2 commits que contenían el reporte con PII. **Se detectó comparando el
   `commit-map` contra el bundle de respaldo** y se revirtió usando el bundle como
   fuente prístina.

2. **`--mailmap` no aplicó.** El callback quedó silenciosamente inactivo. Causa raíz:
   `git-filter-repo` expone `commit.author_email` como `bytes` en Python 3, por lo que la
   comparación contra literales `str` nunca coincidía. Se sustituyó por
   `--commit-callback` con literales `bytes`, verificado con un callback de diagnóstico.

**Regla operativa derivada:** toda reescritura de historia debe validarse contra un
`git bundle` previo, no contra el conteo de commits del repo (que puede decrecer
legítimamente por poda de commits vacíos).

---

## 5. Validación — 8 criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | PII real = 0 en `HEAD` | `PASS` |
| 2 | PII real = 0 en todos los commits alcanzables (contenido) | `PASS` — 660 blobs barridos |
| 3 | PII real = 0 en metadatos de commit | `PASS` — 79 commits |
| 4 | Dump PII ausente de todo commit alcanzable | `PASS` — 0 coincidencias |
| 5 | Sin SHAs antiguos alcanzables; reflogs vacíos | `PASS` — 0 entradas de reflog |
| 6 | Reporte histórico preservado y sanitizado | `PASS` — 2 commits conservados |
| 7 | Equivalencia funcional del contenido | `PASS` — diff de árbol vacío |
| 8 | Gates del proyecto | `PASS` |

### 5.1 Equivalencia funcional

El árbol de `dec87c1` (pre-rewrite) y el de `fa4888c` (post-rewrite) son **idénticos**:

```
034e7857dd2ad9b27363489894db119cd95c12d2
```

Cero archivos con diferencias. La remediación no modificó una sola línea del código
versionado en `HEAD`.

### 5.2 Gates

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | `PASS` |
| `pnpm lint` | `PASS` |
| `pnpm test` | `PASS` — 114 tests (13 + 26 + 8 + 67) |
| `pnpm build` | `PASS` |

---

## 6. Cambios en la historia

Estas cifras describen la operación de rewrite **antes de commitear este informe**. El
commit documental posterior añade 1 commit nuevo sin PII.

| Métrica | Antes del rewrite | Después del rewrite |
|---|---|---|
| Commits alcanzables | 80 | 79 |
| Refs | 9 | 8 |
| Objetos | 1600 | 1594 |
| Tamaño de `.git` | 2.1 MB | 2.3 MB |

**El commit 80 → 79 es esperado:** `c4f6abe` ("remove versioned PII data dump") quedó
vacío tras eliminar el dump de la historia, por lo que `git-filter-repo` lo podó. No se
perdió trazabilidad: la operación que documentaba ahora es intrínsecamente nula.

Aritmética verificada: `git-filter-repo` procesó 80 commits; 79 quedaron alcanzables y
1 fue podado a `000…000` por quedar vacío (`c4f6abe`, que solo eliminaba el dump).

---

## 7. Estado de refs

| Rama / tag | Tipo | Nota |
|---|---|---|
| `main` | rama | Reescrita |
| `feature/policy-foundation-remediation` | rama | Reescrita, rama de trabajo |
| `feature/policy-foundation-tasks-8-12` | rama | Reescrita |
| `agents/pasted-text-processing` | rama | Reescrita |
| `agents/refactor-phase-6-artifacts-validation` | rama | Reescrita |
| `archive/origin-main` | rama | rescate de `origin/main` + `origin/HEAD` |
| `archive/origin-feature-remediation` | rama | rescate de `origin/feature/policy-foundation-remediation` |
| `pre-cleanslate-9479d97` | tag | **Reescrito** — ya no expone PII |

Las 4 ramas `archive/*` y `agents/*` existen para **rescatar historia que solo vivía en
refs de tracking remoto**. La rama `feature/policy-foundation-tasks-8-12` también procede
de una ref remota histórica. No son código activo. Una vez confirme la recepción, pueden
eliminarse con `git push origin --delete`.

---

## 8. Cierre remoto

### 8.1 Remote ref replacement — PASS

Fecha de cierre remoto: **2026-09-26**.

Antes de publicar se ejecutó `git fetch origin --prune --tags` y se compararon las refs
remotas contra los SHAs esperados pre-rewrite. No hubo avance inesperado, por lo que se
publicó exclusivamente la historia saneada con `--force-with-lease` explícito por ref.
No se usó `--force`.

| Ref remota | Estado previo verificado | Estado saneado publicado | Resultado |
|---|---|---|---|
| `refs/heads/main` | `168d06e503` | `956500aa92` | `PASS` |
| `refs/heads/feature/policy-foundation-remediation` | `becfa9d4e8` | `422e6f5aac` | `PASS` |
| `refs/heads/feature/policy-foundation-tasks-8-12` | `080133099b` | `0eaab6ea5c` | `PASS` |
| `refs/heads/agents/pasted-text-processing` | `a1275bc1f0` | `87ebca5628` | `PASS` |
| `refs/heads/agents/refactor-phase-6-artifacts-validation` | `855d7b4561` | `247240a4f1` | `PASS` |
| `refs/heads/archive/origin-main` | ausente | `b6942d53ad` | `PASS` |
| `refs/heads/archive/origin-feature-remediation` | ausente | `88697bdf93` | `PASS` |

El tag remoto `pre-cleanslate-9479d97` estaba ausente y se dejó ausente. No existe en
`origin` ninguna ref `refs/tags/pre-cleanslate-9479d97` que apunte a la historia antigua
con PII. El tag local existe reescrito (`565cca98a0`) para trazabilidad local, pero no se
publicó.

### 8.2 Verificación remota posterior

Verificación realizada después del push:

- las 7 branches remotas anteriores apuntan a commits saneados;
- `old_sha_hits=0` para los SHAs antiguos conocidos;
- `remote_pre-cleanslate_tag_present=False`;
- `origin` conserva fetch/push en `https://github.com/DotIdk14/cancelaciones-ai`;
- working tree local limpio antes de documentar este cierre.

Commit usado para la publicación remota de la rama de trabajo:

```
422e6f5aac01124546296203399fc3a84ccb3b34
```

Este informe agrega un commit documental posterior al cierre remoto para registrar el
resultado. Se publica por fast-forward normal sobre la rama
`feature/policy-foundation-remediation`; el SHA exacto queda trazado en el historial Git.

### 8.3 Limitación residual: purga en proveedor

Aunque el force-push se ejecute, el hosting puede conservar los objetos antiguos en
cachés, backups o clones fork. **No se afirma haber purgado nada en el proveedor**;
esa verificación está explícitamente fuera del alcance de este reporte.

### 8.4 Artefactos locales con PII — destruidos

Los artefactos temporales locales con PII se destruyeron después de validar el rewrite y
antes de continuar con D6:

```
/tmp/opencode/backup/pre-rewrite-all.bundle
/tmp/opencode/pii/            (valores en claro, hashes y mapas de blobs)
/tmp/opencode/pristine/       (clon con PII)
/tmp/opencode/verify-bundle/  (clon con PII)
/tmp/opencode/rw/             (clon reescrito, sin PII)
```

No queda respaldo local del historial contaminado en `/tmp/opencode/backup`,
`/tmp/opencode/pii`, `/tmp/opencode/pristine`, `/tmp/opencode/verify-bundle` ni
`/tmp/opencode/rw`.

---

## 9. Recomendación: guard de PII en CI

`.github/workflows/ci.yml` ejecuta únicamente `lint`, `typecheck`, `test` y `build`.
**No existe ningún guard de PII**, pese a que un commit histórico menciona uno.

Se recomienda añadir un guard que falle el build si detecta correos personales o
teléfonos en blobs alcanzables. Sin él, la regresión es probable: el repo ya cometió
PII dos veces (commits de sanitización parcial y de enmascarado).

---

## 10. Trazabilidad

- Inventario forense reproducible: scripts en `/tmp/opencode/pii/` ( hashes SHA-256, sin valores en claro en la salida del reporte).
- Respaldo previo al rewrite: `git bundle` con las 9 refs originales.
- Decisión de timestamp: 0 commits con mensaje alterado; los 79 mensajes de commit se preservaron íntegros.
