# Evaluacion legacy

Legacy repo: `https://github.com/DotIdk14/Auditor-Cancelaciones`

Commit analizado: `3eb970850b4fc205b72939a1ee744b5c70410688`

| COMPONENT | PATH | PURPOSE | QUALITY | DOMAIN_COUPLING | POLICY_COUPLING | SECURITY_RISK | REUSE_DECISION | REASON |
|---|---|---|---|---|---|---|---|---|
| Vite/React setup | `package.json`, `vite.config.ts` | SPA prototipo | Media | Media | Baja | Baja | REWRITE | Nuevo proyecto prefiere monorepo y probablemente Next.js/Vercel. |
| Tailwind setup | `src/index.css`, deps | Estilos UI | Media | Baja | Baja | Baja | REUSE_WITH_CHANGES | Puede inspirar tokens/clases, no copiar estructura completa. |
| EvidenceViewer | `src/components/audit/EvidenceViewer.tsx` | Preview de evidencia | Media | Media | Baja | Media | REUSE_WITH_CHANGES | Concepto util; requiere storage privado, signed URLs y provenance. |
| CallPlayer | `src/components/audit/CallPlayer.tsx` | Reproductor audio | Media | Media | Baja | Media | REUSE_WITH_CHANGES | Reutilizable conceptualmente; necesita timestamps reales y signed URLs. |
| CallTranscript | `src/components/audit/CallTranscript.tsx` | Transcripcion diarizada UI | Media | Media | Baja | Baja | REUSE_WITH_CHANGES | Buen candidato visual; separar speaker provider de rol inferido. |
| AssemblyAI client | `src/lib/assemblyai.ts` | Transcripcion | Baja-Media | Media | Baja | Alta | REWRITE | Usa browser File/XMLHttpRequest y API key; debe ser server-side durable/idempotente. |
| OpenRouter client | `src/lib/ai/client.ts` | Cliente OpenRouter | Media | Baja | Baja | Media | REUSE_WITH_CHANGES | Manejo de errores util; agregar cost accounting, schemas y routing. |
| Jobs router | `src/server/jobs-router.ts` | Upload/jobs async | Media | Media | Baja | Media | REUSE_WITH_CHANGES | Buenas ideas: SHA-256, limites, storage; ampliar tipos y auth/RLS. |
| Auth InsForge | `src/server/auth/*` | Auth/RBAC | Media | Media | Baja | Media | REUSE_WITH_CHANGES | Revisar contra capacidades reales de InsForge. |
| Policy/rules registry | `src/server/rules/*`, decision engine | Reglas | Variable | Alta | Alta | Media | DISCARD | No confiar por ser legacy; solo rescatar patrones tecnicos tras validar fuente. |
| Mock cases | `src/mock/*` | Demo | Baja | Alta | Alta | Alta | DISCARD | Posible PII y expected no validados. |
| Migrations | `migrations/*` | DB schemas | Media | Media | Media | Media | REUSE_WITH_CHANGES | Usar como referencia, no aplicar ciegamente. |
| PDF generation docs | `docs/phase6-pdf-generation.md` | Estrategia PDF | Media | Media | Baja | Baja | REUSE_WITH_CHANGES | Revisar ideas en fase de reporting. |
| Tests jobs | `tests/jobs/*` | Worker/retry tests | Media | Baja | Baja | Baja | REUSE_WITH_CHANGES | Buen punto de partida para idempotencia. |
