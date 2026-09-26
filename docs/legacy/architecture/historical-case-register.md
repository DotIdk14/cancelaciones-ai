# Registro de casos historicos

| caseId | historicalOutcome | requestedPolicy | availableEvidence | detectedFacts | historicalReasoning | relevantNormativeRules | observedConflicts | possibleHistoricalIssues | extractionTestCandidate | reportTestCandidate | goldenCandidate | goldenValidated | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CaVe-30318 | CV por Estudiante Ilocalizable | 07 Alumno Ilocalizable | Aula, I6/CRM, chat | ingreso breve, contactos sin respuesta, consulta link | No contacto efectivo e ingreso no efectivo | 5.2, 5.8 | Ingreso breve vs no ingreso efectivo | `activarse efectivamente` no existe textual en fuente | si | si | no | false | PII privada. |
| CaVe-30330 | CV por Estudiante Ilocalizable | 07 Alumno Ilocalizable | Aula, I6/CRM | NUNCA en AV, intentos | Intentos minimos y sin contacto efectivo | 5.2, 5.8 | No observado principal | Requiere validar conteos visuales | si | si | candidato | false | Mejor candidato tras anonimizar. |
| CaVe-30344 | CV por Estudiante Ilocalizable | 07 Alumno Ilocalizable | Aula, I6/CRM | NUNCA en AV, llamadas cuestionadas | Dictamen ignora objecion BO | 5.2, 5.8 | BO dice intentos no cumplen horarios diferentes | Puede ser decision discutible | si | si | no | false | Usar como conflict test. |
| CaVe-30354 | CV por Estudiante Ilocalizable | 07 Alumno Ilocalizable | Aula, I6/CRM | ingreso/modalidad/contacto segun BO | Dictamen aplica ilocalizable | 5.2, 5.8 | BO contradice ilocalizable | Puede requerir precedencia owner | si | si | no | false | Usar como conflict test. |
