# Contribuyendo

Este repo es un monolito modular con reglas estrictas sobre lo que **no** debe
existir. Leer `AGENTS.md` antes de tocar código: los invariantes de ahí no son
sugerencias.

---

## Requisitos

| Herramienta | Versión |
|---|---|
| Node.js | La declarada en `package.json` (`engines`). Usa `nvm`/`fnm`/`volta` |
| npm | El que viene con Node |
| InsForge CLI | Solo para aplicar migraciones y crear el bucket |

En Windows corporativo, si PowerShell bloquea `npm` por ExecutionPolicy, usa
`npm.cmd` y `npx.cmd`. No modifiques la política de ejecución para hacer que
funcione.

## Puesta en marcha

```bash
npm ci
cp .env.example .env.local     # completa las obligatorias
npm run dev
```

`npm run dev` ejecuta `predev` (regenera `policy-v5.generated.ts`) y levanta
Vite en `http://localhost:5173`, con `/api/*` montado en el **mismo** dev server
por `scripts/dev-api.mjs`, importando los mismos handlers que usa Vercel. No hay
mock ni backend paralelo en desarrollo.

## Antes de abrir un PR

```bash
npm run verify:release
```

Ejecuta, en orden: lint de secretos → typecheck → contract tests → suite
completa → build. Los cuatro primeros son bloqueantes; el build también.

Si vas a tocar algo que necesita una llamada real a OpenRouter, el smoke se
separa del resto porque **puede generar coste**:

```bash
npm run test:ai-smoke          # auditado
npm run test:ai-smoke:preview  # sin facturar
```

## Reglas del repo que no son negociables

1. **`policy/` no se edita.** Es la fuente normativa del owner. Se *serializa* a
   `src/skills/audit/policy-v5.generated.ts` con `npm run policy:generate`, que ya
   corre en `predev` y `prebuild`.
2. **No reintroduzcas un rules engine.** No hay policy engine, rules engine,
   fact engine, rule evaluation ni catálogos ejecutables de reglas. El dictamen
   **es** el assessment validado que devuelve el modelo.
3. **No hay lógica de negocio en `api/**`.** Cada Function valida, delega en
   `src/server/**` y traduce errores.
4. **InsForge es solo server-side.** Si añades una variable de entorno con prefijo
   `VITE_` o `NEXT_PUBLIC_`, el build falla a propósito.
5. **Nada de PII en el repositorio.** Ni fixtures reales, ni historiales, ni
   capturas.
6. **Los tests no hacen llamadas pagadas.** Si necesitas probar contra el modelo,
   es `test:ai-smoke`, fuera de la suite.
7. **Documentación y UI en español.** El código técnico puede usar inglés si
   mejora la claridad.

## Contrato de commits

Mensajes en español, imperativo y en presente ("añade", no "añadido" ni
"agregado"). Un tema por commit.

```text
<tipo>: <qué cambia, en una línea imperativa>

<por qué, no qué. Qué ya lo dice el diff.>
```

Tipos: `feat`, `fix`, `security`, `docs`, `test`, `refactor`, `build`, `ci`,
`chore`.

Ejemplos:

```text
security: valida la firma real del archivo antes de subir a Storage

El MIME declarado lo elige el cliente, así que un binario renombrado a .txt
entra al expediente como texto y de ahí al prompt. La validación magic-bytes
ocurre antes de la cuota y del upload, para no dejar objetos huérfanos.
```

## Dónde va cada tipo de cambio

| Si tocas… | Prueba con… |
|---|---|
| `api/**`, auth, cuotas, ownership | `tests/security-regressions.test.ts`, `tests/paid-quota.test.ts` |
| Roles y capacidades (`capabilities.ts`, guards) | `tests/role-capabilities.test.ts`, `tests/role-action-matrix.test.ts` |
| Sanitización, schema, referencias | `tests/integrity-untrusted.test.ts` |
| `src/server/quotas.ts` | `tests/quotas.test.ts` |
| Subida y borrado de evidencia | `tests/evidence-upload-guard.test.ts`, `tests/evidence-status.test.ts` |
| Ciclo de vida del dictamen | `tests/evidence-status.test.ts`, `tests/execute.test.ts`, `tests/instructions.test.ts` |
| Inyección en comparaciones | `tests/comparison-injection.test.ts` |
| Revisión humana (dos etapas) y dashboard | `tests/human-review.test.ts`, `tests/reviews-persistence.test.ts`, `tests/CaseReviewPanel.test.ts`, `tests/dashboard*.test.ts` |
| Prompts o contrato con el modelo | `tests/integrity-untrusted.test.ts` + `npm run test:ai-smoke` |

## Cómo escribir tests

- **Prueban comportamiento, no implementación.** Si el test rompe por un refactor
  que no cambió el comportamiento, está mal escrito.
- **Los handlers se prueban a través de `handleRoute`**, no llamando al handler
  crudo: los guards de sesión y CSRF son parte del contrato.
- **`404` para recursos ajenos**, no `403`. Si escribes un test que espera `403`
  sobre un caso ajeno, estás probando un comportamiento que filtraría
  existencia.
- Los tests de cuota necesitan un `ApiError` real (`src/server/errors.ts`): un
  `Error` con `status` a mano no se traduce a `429`, `sendError` lo responde
  `500`.
- Al mockear `../src/server/cases` incluye **todas** las funciones que el
  handler usa, incluidas `getScopedCaseOr404` y `assertCaseOwner`.

### Cuidado con los ciclos de importación

`src/server/errors.ts` existe por una razón concreta: `http.ts` → `auth.ts` →
`insforge.ts` formaba un ciclo que colgaba la suite de tests al sustituir
`insforge` por el store en memoria. Módulos que los tests sustituyen por completo
**no** deben ser importados por el store en memoria.

Si un test se queda colgado sin fallar, busca un ciclo de imports antes que un
problema de timeout. `src/server/derived.ts` se separó de `cases.ts` exactamente
por esto.

## Revisión de código

El revisor mira, en este orden:

1. **Correctitud** — ¿el código hace lo que dice el mensaje del commit?
2. **Seguridad** — ¿la validación ocurre antes del efecto? ¿hay un bypass
   posible? ¿el error filtra algo?
3. **Durabilidad** — ¿el estado depende de memoria de proceso?
4. **Mantenibilidad** — ¿un nombre claro, o una variable que se explica en tres
   líneas?
5. **Estética**, al final.

Un cambio de seguridad sin test que lo fije se considera incompleto: un control
sin cobertura se revierte en el siguiente refactor sin que nadie lo note.