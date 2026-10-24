# Pipeline de IA

Fuente: `src/skills/audit/execute.ts`, `src/server/audit-service.ts` y `src/server/ai/provider.ts`. El procedimiento GDM_GAM_PRD_MLG_003 V5 y su serialización se conservan intactos; este documento describe implementación y no establece criterio normativo.

1. Se verifica adquisición completa, permisos, estados, cuota y derivados. Se preservan hashes y procedencia; los outputs durables se reutilizan cuando corresponde.
2. Se preparan texto, PDF, imágenes y transcripciones; AssemblyAI solo transcribe audio.
3. En auto cada expediente comienza con OpenRouter. Solo un rechazo HTTP 402 por créditos activa Copilot configurado en servidor; saldo consultado, fallos de validación y presupuestos temporales no cambian de proveedor. Se conserva cualquier etapa ya completada.
4. El Skill recibe V5, evidencia preparada y contexto permitido, cercado como contenido no confiable.
5. Una propuesta y un contraste crítico. Desde la autorización expresa del owner del 24/10/2026, el contraste productivo puede corregirse una única vez si su salida falla la validación: máximo tres inferencias, sin repetir la propuesta ni ampliar el deadline. La revisión correctiva recibe su salida rechazada cercada y la ruta del error. Si sigue siendo inválida, termina en ERROR; nunca se publica una propuesta sin contraste válido ni se reinicia otro run automáticamente.
6. Zod, coherencia y referencias validan la respuesta. El servidor agrega metadata real y uso agregado; importes desconocidos quedan null. No reclasifica resoluciones.
7. Se persiste COMPLETED o ERROR. Historial, revisión humana y comparación permanecen separados del dictamen.

BO/HelpDesk admitidos como contexto no crean política ni prueban hechos; las otras áreas son bitácora. La revisión por IA, la autoestimación no calibrada y la decisión humana son distintas. Ver [Copilot](copilot.md) y [antecedentes de fiabilidad](../audits/reliability-review.md).

Esta limpieza no ejecuta inferencias reales. Hashes y pruebas sintéticas comprueban conservación del código, sin medir precisión operativa del modelo.
