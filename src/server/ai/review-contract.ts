/** Contrato técnico de salida; no incorpora criterios ni modifica el assessment. */
export function reviewOutputContract(schemaName?: string): string | null {
  if (schemaName !== 'AuditSemanticReview') return null;
  return [
    '## Comprobación del contrato de trazabilidad antes de devolver el JSON',
    'El validador exige correspondencia completa entre facts y factGrounding. Esta comprobación no sustituye la lectura de originales ni del procedimiento.',
    '1. El assessment FINAL es la propuesta si verdict=CONFIRMED; si verdict=CORRECTED o NEEDS_INPUT, es revisedAssessment. Revisa los facts de ese assessment final, no los de una versión anterior.',
    '2. Para CADA facts[i], emite exactamente un factGrounding con factKey idéntico a facts[i].key. Para OBSERVED o INFERRED, cada ID de facts[i].evidenceIds debe aparecer en alguna citations[j].evidenceId de ESE MISMO factGrounding, con cita literal real y ubicación. También a la inversa: ninguna cita puede referenciar un ID ajeno al evidenceIds de ese hecho.',
    '3. Ejemplo de estructura: si un hecho referencia [A, B], una cita solo de A NO cumple; se requieren citas reales de A y de B. Copia los IDs literales del expediente, sin sufijos, abreviaturas, duplicados ni IDs inventados. A y B son marcadores del ejemplo, no IDs admitidos.',
    '4. No inventes citas para llenar huecos ni elimines referencias automáticamente. Si la propuesta tiene una referencia sin sustento, no la confirmes: aplica el contrato de corrección o de información faltante ya recibido. UNKNOWN exige value=null, evidenceText=null, evidenceIds=[] y citations=[]. HUMAN_CONTEXT conserva las restricciones del contrato original.',
    '5. Antes de responder, compara ambas listas de IDs por cada hecho final. Si corriges el assessment, vuelve a comprobar la correspondencia con los hechos corregidos. Devuelve solo el JSON completo, sin incluir esta comprobación como un campo adicional.',
  ].join('\n');
}
