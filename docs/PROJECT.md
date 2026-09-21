# Proyecto Cancelaciones AI

## Objetivo

Construir un asistente de auditoria que transforme evidencias crudas, politica oficial y la plantilla canonica `Dictamen.pdf` en un dictamen listo para revision humana y entrega.

## Flujo operativo

1. Crear auditoria.
2. Subir archivos disponibles.
3. Presionar `Auditar`.
4. Procesar ingesta, clasificacion, extraccion, transcripcion, normalizacion y evaluacion normativa.
5. Revisar resultado sugerido, faltantes, conflictos, fundamento y evidencias determinantes.
6. Aprobar o corregir.
7. Generar PDF final.

## Separacion de fuentes

- Normativa: `GDM_GAM_PRD_MLG_003`, version 2, y anexos/documentos oficiales provistos por el propietario.
- Plantilla operativa: `templates/Dictamen.pdf`.
- Historicos: PDFs CaVe en `private-historical/`, utiles para extraccion, layout y comparacion, no para politica.
