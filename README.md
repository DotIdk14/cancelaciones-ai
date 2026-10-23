# Cancelaciones AI

Aplicación interna de UTEL para reunir evidencias de solicitudes de cancelación, baja o deserción, emitir dictámenes asistidos por IA y registrar su revisión humana. Cada dictamen conserva referencias a evidencia y al procedimiento oficial del owner. Esta documentación describe el código revisado al 23 de octubre de 2026.

## Funcionalidades implementadas

- Acceso exclusivo con Google OAuth PKCE y autorización por membresía.
- Consulta por matrícula de nueve dígitos y selección de solicitud CaVe desde el portal n8n/Flokzu; incorporación de campos, comentarios y adjuntos con procedencia. La importación Excel está retirada.
- Expedientes con asignación, evidencia original, derivados, historial de auditorías y seguimiento humano.
- Preparación de texto, PDF, imágenes y transcripción de audio; adquisición incompleta bloquea auditoría y puede recuperarse.
- Dictamen estructurado con propuesta y contraste por IA, validación local y errores explícitos.
- Revisión del Asesor y finalización del Coordinador por auditoría, conservando ambas decisiones y comparación separada.
- Resumen, Calidad, IA y Costos, filtros e incidencias; exclusión de pruebas de las métricas operativas.

Mejora continua dispone de tablas y servicios, pero su ruta devuelve 404: no es capacidad operativa habilitada. Las propuestas de vencimiento de tickets y optimización Flokzu están separadas en documentación de decisiones.

## Roles y permisos

| Rol persistido | Presentación | Capacidades relevantes |
|---|---|---|
| user | Asesor | Lee todos los expedientes; escribe y registra su decisión en los propios. |
| coordinator | Coordinador | Lee todos; finaliza cualquier expediente y reintenta fallos bajo guardas; sincroniza Flokzu según su capacidad. Comentarios por área requieren propiedad. |
| manager | Gerente | Consulta global y mantenimiento administrativo acotado; no modifica evidencia ni registra revisión humana. |

El servidor resuelve capacidades desde app_memberships; correo permitido no basta. Los permisos no dependen del preview local ni de ocultar controles. Consultar `src/server/capabilities.ts` y [seguridad](SECURITY.md).

## Flujo de auditoría

1. Consultar matrícula, seleccionar CaVe y completar adquisición del expediente.
2. Verificar evidencia y derivados, permisos, bloqueos y cuotas; preservar originales y procedencia.
3. Preparar contexto con procedimiento GDM_GAM_PRD_MLG_003 V5 proporcionado por el owner.
4. Seleccionar proveedor antes de inferir; ejecutar propuesta y contraste crítico dentro del presupuesto de dos llamadas.
5. Validar assessment con Zod, coherencia y referencias; persistir resultado terminal y metadata real. Una falla no publica la propuesta.
6. Registrar revisión del Asesor, finalización del Coordinador y comparación independiente. El estado se deriva: PENDING_ADVISOR → PENDING_COORDINATOR → FINALIZED.

Los ocho identificadores de resolución viven en `src/skills/audit/types.ts`; esta guía no redefine sus criterios. No existe motor ejecutable de reglas. [Pipeline](docs/architecture/ai-pipeline.md).

## Arquitectura y tecnologías

SPA React 19 + Vite 6 + TypeScript + Tailwind; navegación por hash, sin react-router. Vercel Functions usa el mismo origen HTTP y delega en un monolito modular. InsForge aporta PostgreSQL, Storage e identidad exclusivamente en servidor. OpenRouter y el SDK oficial de Copilot transportan inferencias; AssemblyAI transcribe audio. Zod valida contratos; Cheerio lee HTML de Flokzu sin ejecutar JavaScript; pdfjs-dist procesa PDF; Recharts muestra métricas. Vitest y Testing Library verifican flujos con datos sintéticos; ESLint y TypeScript verifican código.

```text
api/              12 Functions; auth y dashboard consolidadas
src/components/   interfaz, expediente y dashboards
src/lib/          cliente API, hooks, rutas y presentación
src/server/       autorización, persistencia, proveedores e integraciones
src/skills/       auditoría y contratos protegidos
policy/           fuentes normativas inmutables del owner
migrations/       baseline e incrementos históricos
scripts/          desarrollo, verificaciones y generación
tests/           pruebas (directoriotests/ en raíz)
docs/             arquitectura, guías, operación e informes
.github/          CI y plantillas
```

## Instalación local

Requiere Node >=22.12.0, npm y acceso autorizado a las credenciales del proyecto.

```powershell
npm ci
Copy-Item .env.example .env.local
# Completar las variables de servidor con el responsable del proyecto.
npm run dev
```

Confirmar el host InsForge enlazado: existen referencias históricas distintas en ejemplos e instrucciones. No reutilizar un host por aparecer en un documento. El login local exige APP_URL y retorno OAuth autorizado. Vite monta los handlers mediante scripts/dev-api.mjs; npm run preview sirve solo el frontend compilado. predev y prebuild regeneran el archivo compilado de Policy; comprobar hashes si se trabaja con congelamiento normativo. [Guía local](docs/guides/local-development.md).

## Variables de entorno

Todas son de servidor. No usar prefijos VITE_ ni NEXT_PUBLIC_. `.env.local`, configuración CLI y secretos remotos permanecen fuera de Git. La autoridad técnica es `src/server/env.ts`; `.env.example` orienta sin sustituir el proyecto enlazado.

| Variables | Finalidad |
|---|---|
| INSFORGE_BASE_URL, INSFORGE_ANON_KEY, INSFORGE_API_KEY | Conexión, identidad y cliente administrativo; obligatorias. |
| INSFORGE_STORAGE_BUCKET | Bucket privado de evidencia; default evidencias. |
| OPENROUTER_API_KEY, OPENROUTER_MODEL | Credencial y modelo principal; requeridos por la configuración actual. |
| OPENROUTER_REVIEW_MODEL | Revisor; default definido en env.ts. |
| OPENROUTER_FALLBACK_MODEL | Configuración opcional existente; no habilita superar el presupuesto del Skill. |
| AI_PROVIDER_MODE, OPENROUTER_MIN_BALANCE_USD | Selección openrouter, github-copilot o auto antes de inferir. |
| COPILOT_GITHUB_TOKEN, COPILOT_MODEL, COPILOT_REVIEW_MODEL | Respaldo Copilot en servidor; necesarios cuando se selecciona ese proveedor. |
| ASSEMBLYAI_API_KEY, ASSEMBLYAI_REQUEST_TIMEOUT_MS | Transcripción y timeout HTTP de audio. |
| APP_URL | Origen de aplicación y retornos OAuth derivados por servidor. |
| QUOTA_HMAC_KEY | Sujeto de cuota hasheado; fallback existente a clave administrativa. |
| AI_TIMEOUT_MS, TOTAL_AUDIT_TIMEOUT_MS, AUDIT_STALE_AFTER_MS | Presupuestos de espera y detección de intento obsoleto. |
| AI_MAX_OUTPUT_TOKENS | Presupuesto de salida del modelo. |
| MAX_EVIDENCE_BYTES, MAX_EVIDENCE_COUNT | Límites de carga. |
| MAX_AUDIT_TEXT_CHARS, MAX_AUDIT_TEXT_CHARS_PER_EVIDENCE, MAX_AUDIT_MULTIMODAL_BYTES | Límites del contexto preparado. |
| TRANSCRIPTION_POLL_TIMEOUT_MS | Espera acotada de transcripción. |
| COMPARISON_MAX_RETRIES, COMPARISON_RETRY_MIN_BACKOFF_MS | Recuperación de la comparación independiente. |

VERCEL_URL y NODE_ENV son variables del runtime; RUN_AI_SMOKE habilita pruebas live y no es requisito normal del producto. Valores y defaults completos se consultan en env.ts, sin copiarlos a Notion.

## Base de datos

El dictamen fuente es audits.result_json. La revisión humana vive en case_reviews por auditoría; country/channel son proyecciones y el workflow se deriva en lectura. project_admin omite RLS: capacidades y propiedad se verifican en código.

El ledger remoto consultado tiene 34 entradas hasta 20261022163849. Conservar migraciones históricas y no aplicar --all a producción. Las 34 migraciones están versionadas y registradas en el ledger. human-resolution también está versionada, aunque figure en .gitignore; esa entrada no la elimina de Git. El ensayo completo desde cero queda como comprobación adicional, no como SQL pendiente de producción. [Estado y procedimiento](docs/operations/migrations.md).

## Despliegue y mantenimiento

Vercel usa npm ci, npm run build y dist. El deployment de producción inspeccionado coincide con main inicial, READY y doce Functions. El plan Hobby no admite otro archivo de API sin consolidación. No confundir build correcto con publicación correcta. Esta entrega publica documentación; conserva el código y el esquema productivo. [Guía de despliegue](docs/guides/deployment.md).

Monitorear errores HTTP, intentos ERROR o estancados, adquisición incompleta, transcripciones, cuotas y consumo real reportado. health/ai ofrece diagnóstico técnico, no certifica precisión. Conservar historial y originales al recuperar fallos. Actualizar dependencias con lockfile y CI; aplicar SQL solo después de respaldo, ensayo y aprobación. [Diagnóstico](docs/guides/troubleshooting.md).

## Pruebas

```powershell
npm run lint
npm run test:contract
npm test
npm run build
# Todo el gate anterior:
npm run verify:release
```

test:ai-smoke y test:ai-smoke:preview requieren configuración y pueden consumir servicios externos; no forman parte de la verificación sintética. copilot:check comprueba la integración configurada. Una suite aprobada no equivale a probar OAuth real, adquisición de PII o precisión del modelo en producción.

## Documentación adicional

[Índice central](docs/README.md), [arquitectura](docs/architecture/README.md), [seguridad](SECURITY.md), [contribución](CONTRIBUTING.md) e [informe de auditoría](docs/audits/cleanup-report.md). Policy y sus dependencias se verifican contra [hashes iniciales](docs/audits/protected-files.json).
