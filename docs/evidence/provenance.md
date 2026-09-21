# Provenance

Toda afirmacion debe navegarse como:

DICTAMEN -> REGLA -> CONDICION -> HECHO -> EVIDENCIA -> UBICACION EXACTA.

## Ubicaciones

- PDF/imagen: pagina y bounding box.
- Texto: offsets o fragmento.
- Tabla: fila, columna y valor.
- Audio: timestamp inicio, timestamp fin, speaker provider, rol inferido y texto.

## Ejemplo

```json
{
  "factId": "fact_123",
  "type": "classroom.hasGrades",
  "value": false,
  "source": {
    "evidenceId": "ev_456",
    "page": 1,
    "boundingBox": { "x": 10, "y": 20, "width": 120, "height": 35 }
  },
  "extraction": {
    "provider": "openrouter",
    "model": "vision-cheap",
    "confidence": 0.91
  }
}
```
