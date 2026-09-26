### Task 6: Evidence validation y Extraction Tools shadow

**Files:**
- Create: `apps/web/src/server/extraction/contracts.ts`
- Create: `apps/web/src/server/extraction/contracts.test.ts`
- Create: `apps/web/src/server/extraction/evidence-reference-validation.ts`
- Create: `apps/web/src/server/extraction/evidence-reference-validation.test.ts`
- Create: `apps/web/src/server/extraction/registry.ts`
- Create: `apps/web/src/server/extraction/registry.test.ts`
- Create: `apps/web/src/server/extraction/tools/extract-dates.ts`
- Create: `apps/web/src/server/extraction/tools/extract-dates.test.ts`
- Create: `apps/web/src/server/extraction/tools/extract-contact-attempts.ts`
- Create: `apps/web/src/server/extraction/tools/extract-contact-attempts.test.ts`

**Interfaces:**
- Consumes: `ExtractedFactV1`, `JobArtifact`, `extractFactsFromArtifacts`.
- Produces: `ExtractionTool`, `ExtractionToolRegistry`, `validateEvidenceReferences`, `createDefaultExtractionToolRegistry`.

- [ ] **Step 1: Escribir RED de firewall Zod**

```ts
const outputSchema = z.object({ facts: z.array(extractedFactSchema) }).strict();
expect(outputSchema.safeParse({ facts: [] }).success).toBe(true);
for (const forbidden of ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision']) {
  expect(outputSchema.safeParse({ facts: [], [forbidden]: 'CANCELACION_VENTA' }).success).toBe(false);
}
```

- [ ] **Step 2: Implementar contratos mínimos y GREEN**

El tool metadata será:

```ts
interface ExtractionTool<TInput, TOutput> {
  id: string;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  deterministic: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(input: TInput, context: ExtractionToolContext): Promise<TOutput>;
}
```

- [ ] **Step 3: Escribir RED de evidence references**

Probar: ID inexistente, artifact de otra auditoría, hash distinto, artifact humano en modo blind y referencia permitida. `validateEvidenceReferences` devolverá errores con codes `EVIDENCE_NOT_FOUND`, `EVIDENCE_AUDIT_MISMATCH`, `EVIDENCE_HASH_MISMATCH`, `EVIDENCE_NOT_ALLOWED_BLIND`.

- [ ] **Step 4: Implementar y verificar GREEN**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/evidence-reference-validation.test.ts
```

- [ ] **Step 5: Escribir RED de registry**

`registry.get('extract_dates')`, `registry.list()` y `registry.execute('extract_dates', input, context)` deben devolver metadata estable. Registrar tools duplicados debe lanzar `EXTRACTION_TOOL_DUPLICATE`.

- [ ] **Step 6: Implementar registry mínimo y GREEN**

- [ ] **Step 7: Escribir RED de `extract_dates`**

Reconocerá exclusivamente fechas estructuradas en `artifact.result.extractedFacts` cuyo `factType` sea `evidence.date` o `date`, con string ISO parseable. Sin fechas devolverá `facts: []`, no `false`.

- [ ] **Step 8: Implementar `extract_dates` con provenance completa**

Cada fact tendrá `state: 'OBSERVED'`, `extractionMethod: 'DETERMINISTIC'`, `extractorId: 'extract_dates'`, `extractorVersion: '1.0.0'`, evidence/artifact/hash de origen.

- [ ] **Step 9: Escribir RED e implementar `extract_contact_attempts`**

Llamará `extractFactsFromArtifacts({ auditId, runId: 'shadow', artifacts: [artifact] })`, filtrará `contact.callAttempts` y `contact.writtenInteractions`, y mapeará cada source a `FactProvenanceV1`. No copiará regex ni normalización de contactos.

- [ ] **Step 10: Verificar suite completa**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction
pnpm --filter @cancelaciones/web typecheck
```

Expected: PASS; ningún caller productivo importa el registry.

---

