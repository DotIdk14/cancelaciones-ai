# Arquitectura técnica

Monolito modular con un paquete npm. React 19, Vite 6, TypeScript y Tailwind sirven una SPA; las 12 Functions de Vercel delegan en servicios de servidor. No hay Next.js ni monorepo pnpm. El navegador usa la API del mismo origen; InsForge queda exclusivamente en servidor.

## Fronteras

- `src/App.tsx` y `src/lib/useHashRoute.ts` componen Resumen, Calidad, IA y Costos, casos, nueva auditoría, incidencias y detalle con intentos históricos.
- `api/**` valida y delega; `src/server/http.ts` aplica sesión y CSRF. Auth y dashboard consolidan operaciones por archivo para respetar Hobby.
- Servicios de `src/server/` persisten originales, derivados, auditorías y revisiones. La autorización depende de capacidades y propiedad en código: el cliente administrativo omite RLS.
- `src/skills/audit/**` recibe V5 del owner, prepara contexto y valida el assessment; no existe motor ejecutable de reglas. Ver [pipeline](ai-pipeline.md).
- InsForge provee PostgreSQL, identidad y Storage; n8n/Flokzu la adquisición; OpenRouter o Copilot la inferencia; AssemblyAI la transcripción.

## Seguridad y roles

Google OAuth PKCE en servidor, cookies HttpOnly, membresía obligatoria y denegación ante rol desconocido. Asesor y Coordinador escriben según propiedad y capacidad; el Coordinador finaliza cualquier caso y puede reintentar errores bajo guardas. El Gerente no emite revisión ni modifica evidencia; tiene mantenimiento administrativo acotado sujeto al endpoint. Comentarios por área conservan propiedad. Ver [seguridad](../../SECURITY.md) y `src/server/capabilities.ts`.

La revisión se deriva por auditoría: PENDING_ADVISOR → PENDING_COORDINATOR → FINALIZED. La decisión del Asesor se preserva. Casos de prueba se excluyen de métricas operativas en servidor. Revisiones, cuotas e intentos son durables.

Mejora continua tiene tablas y servicios, pero dashboard rechaza la vista con 404 antes de ejecutar operaciones. No es función habilitada ni se elimina su código sin estudiar sus dependencias del auditor. Ver [datos](database.md), [Flokzu](flokzu.md), [métricas](dashboard-metrics.md) y [expedientes](case-workflow.md).

## Antecedentes de decisiones

Conservados del documento previo; prevalece el estado vigente descrito arriba.

### Decisiones clave (ADRs)

### ADR 1 — Sin variables públicas al navegador
No existe `VITE_` ni `NEXT_PUBLIC_` para secretos.
`src/server/env.ts` verifica en runtime que no haya variables sensibles con esos prefijos.
Razón: InsForge y OpenRouter son server-side; exponer keys al bundle sería una fuga.

### ADR 2 — Hash routing sin react-router
La SPA enruta `#/`, `#/casos`, `#/casos/:id`, `#/calidad`, etc. con `src/lib/useHashRoute.ts`.
Razón: refresh funciona sin rewrites de fallback en Vercel; no se envía estado de ruta al servidor.

### ADR 3 — Auth server-side por cookies httpOnly
El navegador no lee tokens InsForge. `@insforge/sdk/ssr/middleware` escribe cookies `httpOnly`, `Secure`, `SameSite=Lax`.
`requireAuth` resuelve la identidad remota contra InsForge y luego consulta `app_memberships` para el rol.
Razón: prevenir XSS sobre tokens y mantener el control de autorización centralizado en el servidor.

### ADR 4 — RLS como defensa en profundidad, no frontera primaria
El backend usa `createAdminClient` (`INSFORGE_API_KEY`) para escribir/leer todo.
Las políticas RLS aplican al rol `authenticated` en caso de que una cookie/token llegue directamente desde el navegador.
Los permisos por rol NO se implementan en RLS: se resuelven en código con `capabilitiesForRole` + `assertCaseWriteCapability`/`assertCaseOwner`/`getScopedCaseOr404`, porque para `project_admin` las políticas no aplican.
Razón: la frontera real es "navegador solo llama /api" + los guards de capacidad; la RLS es un segundo muro.

### ADR 5 — Auditoría durable sin cola
`audit-service.ts` inserta una fila `audits` en `RUNNING` antes de llamar al modelo.
Si la función de Vercel muere, el siguiente GET /audit sana el RUNNING caducado como `ERROR`.
Razón: cumple `NO_PROCESS_LOCAL_DURABILITY` sin reintroducir jobs/colaboradores.

### ADR 6 — Un solo proveedor de IA con fallback de formato/modelo
`src/server/openrouter.ts` es el único transporte. Consulta el catálogo de capacidades, prueba `json_schema` estricto y cae a `json_object`; usa `OPENROUTER_MODEL` y `OPENROUTER_FALLBACK_MODEL`.
Máximo dos intentos reales por llamada.
Razón: la salida se valida con Zod; la robustez se consigue con fallback de contrato y modelo, no con múltiples proveedores.

### ADR 7 — Procedimiento V5 inyectado como texto
`policy/` se compila a `src/skills/audit/policy-v5.generated.ts` en `predev`/`prebuild`.
El system prompt incluye el procedimiento completo.
Razón: `POLICY_IS_IMMUTABLE` y `ONLY_OWNER_PROVIDED_POLICY_SOURCES`; no se busca política en internet ni se traduce a reglas.

### ADR 8 — Resolución humana manda sobre el dictamen
`case_reviews` registra la decisión de la persona; `deriveEffectiveResolution` (lectura) decide si la resolución vigente es `HUMAN` o `AI`.
La comparación (`case_comparisons`) solo evalúa si el modelo coincide/discrepa; no reemplaza la decisión humana.
Razón: trazabilidad sin alterar el dictamen original.

### ADR 9 — Revisión humana en dos etapas con estado derivado
El Asesor propone (`case_reviews.result`) y el Coordinador finaliza (`coordinator_decision` + `coordinator_resolution`), guardados APARTE para no perder quién propuso qué.
El estado del flujo (`PENDING_ADVISOR`/`PENDING_COORDINATOR`/`FINALIZED`) se DERIVA en lectura (`deriveWorkflowState`); no se añade una columna de estado ni se reutiliza `cases.status`.
Razón: una columna de estado podría desincronizarse de la fila; derivarlo de la fila hace imposible el estado contradictorio.

### ADR 10 — Casos de prueba (`is_test`) excluidos en SQL
`cases.is_test` (default `false`) marca pruebas; el servidor filtra `is_test = false` en las consultas y las vistas de dashboard proyectan la columna para que el filtro viaje en SQL antes del `count`/`limit`.
Razón: las pruebas no deben inflar las métricas operativas, y filtrarlas en memoria después del recorte contaba mal el total.
