# Interpretaciones no normativas de la política — ARCHIVO

> **ESTA CARPETA NO ES NORMATIVA. NO LA USES COMO FUENTE DEL RULE ENGINE.**

## Contenido histórico

Los documentos de esta carpeta eran la interpretación interna que el equipo
había construido sobre `GDM_GAM_PRD_MLG_003`. Antes de la fase *clean slate*
vivían en `docs/policy/`, nombre que podía confundirse con material normativo.
Por eso se movieron aquí.

## Advertencias

El contenido de esta carpeta:

- es **histórico**;
- **NO es normativo**;
- **NO debe utilizarse como fuente** del Rule Engine ni de ningún motor normativo;
- **puede contener errores**;
- **puede contradecir** `GDM_GAM_PRD_MLG_003`.

Se conserva **únicamente por trazabilidad**.

## Errores ya demostrados

Estos defectos fueron verificados contra el PDF oficial durante la auditoría
*clean slate* y son la razón de esta cuarentena:

| Documento | Defecto verificado |
|---|---|
| `rule-inventory.md` | Declara **15 llamadas** en 5.2.b; la fuente (5.2.a, pág. 3) establece **16**. |
| `rule-inventory.md` | Cita 5.7.e en pág. 9; la fuente la ubica en pág. **11**. |
| `rule-inventory.md` | Cita 5.8.a en págs. 9-10; la fuente la ubica en pág. **12**. |
| `v5-coverage.md` | Declara 5.2, 5.7.e y 5.8 como `IMPLEMENTED`; la cobertura real era de aproximadamente el 7% de los incisos. |
| `v5-coverage.md` | Omite la sección **5.1** de la lista de secciones no implementadas, aunque 5.1 contiene 7 incisos normativos. |
| `outcome-inventory.md` | Refleja el vocabulario de outcomes del motor retirado, no el del procedimiento. |

## Regla para el futuro

**Ningún loader, script, prompt, test o implementación puede consumir
automáticamente esta carpeta.**

Si la V2 necesita recuperar algo de aquí, debe **re-derivarse desde
`GDM_GAM_PRD_MLG_003`** y documentarse en un ADR nuevo. Copiar una fila de
`rule-inventory.md` al motor V2 reproduciría exactamente los defectos
listados arriba.

## Fuente normativa

```
normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf
```

V5 · publicado 14/09/2026 · 26 páginas.
