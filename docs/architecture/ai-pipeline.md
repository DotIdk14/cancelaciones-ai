# Pipeline de IA

Fuente: `src/skills/audit/execute.ts`, `src/server/audit-service.ts` y `src/server/ai/provider.ts`. El procedimiento GDM_GAM_PRD_MLG_003 V5 y su serialización se conservan intactos; este documento describe implementación y no establece criterio normativo.

1. Se verifica adquisición completa, permisos, estados, cuota y derivados. Se preservan hashes y procedencia; los outputs durables se reutilizan cuando corresponde.
2. Se preparan texto, PDF, imágenes y transcripciones; AssemblyAI solo transcribe audio.
3. Se selecciona proveedor antes de inferir. OpenRouter es predeterminado; auto consulta presupuesto y puede elegir Copilot con credenciales y modelos en servidor. El proveedor se conserva en propuesta y contraste.
4. El Skill recibe V5, evidencia preparada y contexto permitido, cercado como contenido no confiable.
5. Hay dos llamadas reales: propuesta y contraste crítico, cada transporte con un intento. No se publica propuesta si falla contraste ni se reinicia en otro proveedor.
6. Zod, coherencia y referencias validan la respuesta. El servidor agrega metadata real y uso agregado; importes desconocidos quedan null. No reclasifica resoluciones.
7. Se persiste COMPLETED o ERROR. Historial, revisión humana y comparación permanecen separados del dictamen.

BO/HelpDesk admitidos como contexto no crean política ni prueban hechos; las otras áreas son bitácora. La revisión por IA, la autoestimación no calibrada y la decisión humana son distintas. Ver [Copilot](copilot.md) y [antecedentes de fiabilidad](../audits/reliability-review.md).

Esta limpieza no ejecuta inferencias reales. Hashes y pruebas sintéticas comprueban conservación del código, sin medir precisión operativa del modelo.
