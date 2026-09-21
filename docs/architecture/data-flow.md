# Flujo de datos

1. Originales: archivos subidos por el auditor se guardan privados, con SHA-256, MIME validado, tamano y provenance.
2. Derivados: texto extraido, paginas renderizadas, OCR/vision, transcripciones y segmentos se guardan como artefactos derivados.
3. Facts: la evidencia se transforma en hechos estructurados con ubicacion exacta y confianza de extraccion.
4. Normalizacion: fechas, canales, conteos e indicadores se normalizan sin consumir IA si ya existen facts.
5. Motor: evalua reglas con TRUE, FALSE, UNKNOWN y NOT_APPLICABLE.
6. Dictamen sugerido: incluye outcome, faltantes, conflictos, reglas, evidencias y trazas.
7. Reporte: genera draft de `Dictamen.pdf`, luego PDF final tras aprobacion o correccion humana.
