# Model routing

## Principio

Usar el modelo mas barato que complete la tarea de forma confiable.

## Ruta inicial

1. Parser determinista local para PDFs con texto, CSV/XLSX, metadata y fechas obvias.
2. OCR/vision economica para screenshots simples.
3. LLM economico con JSON Schema para extraccion estructurada simple.
4. Modelo superior solo si falla validacion, hay baja confianza o imagen compleja.
5. Fallback de alta capacidad solo para evidencias decisivas no resueltas.

## Validacion

Toda salida LLM debe validar schema, tipos, fechas y referencias a evidencia. Si no valida, no alimenta el motor.
