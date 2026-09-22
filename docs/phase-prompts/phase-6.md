# ============================================================
# CANCELACIONES AI
# PHASE 6
# VERSION-AWARE POLICY ENGINE + MACHINE DECISION
# + NORMATIVE SHADOW EVALUATION
# ============================================================

Estás iniciando Phase 6 de Cancelaciones AI.

NO tienes contexto de chats anteriores.

Reconstruye el contexto desde el repositorio y las fuentes normativas
proporcionadas por el OWNER.

NO avances a Phase 7 durante esta ejecución.

============================================================
0. ESTADO ACTUAL
============================================================

Phase 5 terminó:

PASS

Ya existe:

- evidencia original privada e inmutable;
- SHA-256;
- artifacts canónicos;
- AssemblyAI/OpenRouter adapters;
- jobs durables;
- idempotencia;
- provenance;
- cost accounting;
- Fact Model;
- Fact Extraction Runs;
- facts OBSERVABLE;
- facts HUMAN_CONFIRMED/HUMAN_CORRECTED separados;
- freeze de Fact Runs;
- historical human references aisladas;
- shadow evaluation base;
- policy version pinning;
- GDM_GAM_PRD_MLG_003 V2 preservada;
- GDM_GAM_PRD_MLG_003 V5 registrada como versión actual suministrada.

Phase 5 NO implementó:

- Rule Engine productivo;
- outcome normativo AI;
- resolución normativa de conflictos;
- Dictamen.pdf final.

Eso es correcto.

============================================================
1. OBJETIVO DE PHASE 6
============================================================

Construir el MOTOR NORMATIVO PRODUCTIVO.

Input:

FACTS ESTRUCTURADOS
+
POLICY CODE
+
POLICY VERSION

Output:

EVALUATED RULES
+
UNKNOWN CONDITIONS
+
MISSING DATA
+
CONFLICTS
+
SUGGESTED OUTCOME
+
REVIEW REQUIREMENT
+
FULL TRACE

Debe ser posible ejecutar:

evaluatePolicy({
  facts,
  policyCode,
  policyVersion
})

NO:

evaluatePolicy(facts)

hardcodeado a V5.

============================================================
2. EXPERIENCIA OBJETIVO
============================================================

Al terminar Phase 6 quiero poder:

1. Crear/abrir auditoría.
2. Seleccionar/preservar policy version.
3. Procesar evidencias.
4. Extraer Facts.
5. Congelar Fact Run.
6. Presionar:

   EVALUAR POLÍTICA

7. Ver:

   Resultado sugerido
   Reglas aplicadas
   Reglas descartadas
   Datos faltantes
   UNKNOWN
   Conflictos
   Evidencias determinantes
   Fundamento exacto

8. Si existe Dictamen humano histórico:

   comparar:

   MACHINE OUTCOME
   vs
   HUMAN HISTORICAL OUTCOME

9. Clasificar discrepancia.

NO generar todavía el PDF oficial final.

============================================================
3. PRE-FLIGHT
============================================================

Leer completamente:

AGENTS.md

docs/reports/phase-5-report.md

docs/policy/source-register.md

docs/policy/v2-vs-v5-semantic-diff.md

docs/policy/rule-inventory.md

docs/policy/fact-inventory.md

docs/policy/outcome-inventory.md

docs/policy/traceability-matrix.md

docs/policy/ambiguities.md

docs/policy/conflicts.md

docs/policy/normative-dependencies.md

docs/architecture/data-model.md

docs/architecture/fact-extraction.md

docs/architecture/shadow-evaluation.md

docs/testing/shadow-evaluation.md

docs/testing/extraction-regression.md

Inspeccionar:

packages/domain
packages/db
apps/web
migrations

Ejecutar:

git status --short
git log --oneline -10

Debe existir tree limpio antes de comenzar.

============================================================
4. FUENTES NORMATIVAS
============================================================

Fuente principal actual proporcionada:

Código:
GDM_GAM_PRD_MLG_003

Versión:
5

Fecha publicación:
14/09/2026

V2 debe permanecer disponible como versión histórica.

NO buscar políticas en Internet.

NO utilizar casos históricos como fuente normativa.

NO completar anexos faltantes mediante conocimiento general.

============================================================
5. POLICY VERSION PINNING
============================================================

Toda ejecución debe recibir explícitamente:

policyCode
policyVersion

La auditoría debe estar pinned.

Una corrida V2 jamás debe cambiar porque V5 sea current.

Una corrida V5 jamás debe leer accidentalmente reglas V2.

Test obligatorio:

same facts
+
V2

y

same facts
+
V5

pueden producir evaluaciones diferentes sin modificar una a la otra.

============================================================
6. POLICY_VERSION_EFFECTIVE_DATE_RULE
============================================================

Sigue sin existir criterio OWNER confirmado para asignar automáticamente
versiones según fecha del caso.

NO inventarlo.

Por tanto:

- nueva auditoría puede usar V5 como default visible;
- históricos requieren policyVersion explícita;
- UNKNOWN/UNASSIGNED debe bloquear RUN_ENGINE hasta seleccionar versión.

============================================================
7. MOTOR PURO
============================================================

Crear paquete/módulo de dominio puro.

Preferencia conceptual:

packages/policy-engine

si la separación está justificada.

Debe ser:

PURE
DETERMINISTIC
SYNCHRONOUS CORE
TESTABLE
VERSION-AWARE

Cero imports de:

React
Next.js
InsForge
OpenRouter
AssemblyAI
filesystem
HTTP

============================================================
8. API PURA
============================================================

Interfaz conceptual:

evaluatePolicy({
  policyCode,
  policyVersion,
  facts,
  ownerPrecedences?
}): PolicyEvaluation

El motor puro NO consulta DB.

El runtime externo:

DB
↓
effective facts
↓
policy set
↓
pure engine
↓
persist result

============================================================
9. CONDITION STATE
============================================================

Toda condición debe poder resultar:

TRUE
FALSE
UNKNOWN
NOT_APPLICABLE

Regla absoluta:

UNKNOWN != FALSE.

Ejemplo:

"La evidencia no dice si seleccionó modalidad"

NO significa:

"no seleccionó modalidad".

============================================================
10. RULE RESULT
============================================================

Cada regla debe producir algo equivalente a:

{
  ruleId,
  status:
    SATISFIED |
    NOT_SATISFIED |
    UNKNOWN |
    NOT_APPLICABLE,

  source: {
    documentCode,
    version,
    section,
    page
  },

  conditions: [...],

  factsUsed: [...],

  evidenceRefs: [...],

  outcomeEffect: ...,

  missingFacts: [...],

  blockedBySource: ...
}

============================================================
11. TRACE
============================================================

Debe poder recorrerse:

MACHINE DECISION
↓
RULE
↓
CONDITION
↓
FACT
↓
ARTIFACT
↓
EVIDENCE
↓
PAGE / TIMESTAMP / CELL
↓
ORIGINAL SHA-256

Si una decisión no puede producir esta cadena:

es un bug.

============================================================
12. NO CONFIDENCE NORMATIVA
============================================================

No crear:

decisionConfidence = 83%

No existe probabilidad normativa.

Puede existir:

fact.extractionConfidence

pero una regla:

cumple
no cumple
unknown
no aplica.

============================================================
13. FORMALIZACIÓN V5
============================================================

Formalizar solamente reglas sustentadas directamente por:

GDM_GAM_PRD_MLG_003 V5

y fuentes OWNER realmente disponibles.

Toda regla debe tener cita exacta.

No crear reglas desde:

historical CaVe
legacy repo
intuición
práctica informal
LLM.

============================================================
14. RULE IDs
============================================================

Crear IDs estables.

Ejemplo conceptual:

GDM-V5-5.2-A-CALLS
GDM-V5-5.3-A-I
GDM-V5-5.8-A
GDM-V5-5.9-C
GDM-V5-5.11-B

No es obligatorio exactamente este formato.

Pero debe incluir suficiente información para rastrear versión/sección.

============================================================
15. RULE DEFINITIONS AS DATA
============================================================

Las reglas deben estar declaradas explícitamente.

Preferir:

TS data structures

o JSON validado.

No esconder condiciones normativas en:

route handlers
React components
SQL random
prompts.

El código evaluador puede ser genérico.

La política debe ser visible/revisable.

============================================================
16. VERSIONED RULE SET
============================================================

Conceptualmente:

policySets = {
  "GDM_GAM_PRD_MLG_003": {
     "2": rulesV2,
     "5": rulesV5
  }
}

No es obligatorio esta implementación exacta.

Pero debe existir aislamiento real entre versiones.

============================================================
17. RULESET FINGERPRINT
============================================================

Generar:

rulesVersion / rulesFingerprint

determinista.

Debe cambiar cuando cambia el contenido efectivo de reglas.

Persistirlo en cada engine run.

============================================================
18. BUSINESS DAYS
============================================================

Implementar cálculo puro reutilizable.

Por requisito OWNER actual:

DÍA HÁBIL =
lunes a viernes.

NO considerar festivos.

Funciones puras y testeadas.

Necesario para:

SLA
plazos
ventanas que explícitamente utilicen días hábiles.

============================================================
19. DATE WINDOWS
============================================================

Evitar lógica tipo:

differenceInDays(...) <= N

sin analizar inclusión/exclusión de límites.

Tests obligatorios:

un día antes
día exacto
un día después
lunes
viernes
fin de semana
cambio de mes
cambio de año

según reglas aplicables.

============================================================
20. V5 5.2 — INTENTOS DE CONTACTO
============================================================

Formalizar con especial cuidado.

El motor debe evaluar usando ContactAttempt OBSERVABLES.

V5 contempla, entre otros requisitos documentados:

- mínimo 16 llamadas;
- al menos dos llamadas diarias;
- horarios diferentes;
- al menos 6 horas de diferencia;
- mínimo 6 interacciones escritas;
- distribución de interacciones:
  semana 1 = 70%
  semana 2 = 30%;
- llamadas agrupadas en un lapso/intervalo corto pueden contar como una
  interacción según la regla;
- existe tratamiento adicional para estudiantes que ingresan posteriormente
  al inicio y hasta miércoles de semana 1.

NO calcular estos valores con LLM.

Crear funciones puras.

Ejemplos conceptuales:

countValidCalls(...)
groupCalls(...)
calculateInteractionDistribution(...)
validateDailyCallSpacing(...)

Cada cálculo debe producir trace.

============================================================
21. PORCENTAJES 70/30
============================================================

No inventar criterio de redondeo.

Revisar texto fuente.

Si el documento no especifica:

floor / ceil / exact counts

documentar ambigüedad.

No inventar silenciosamente.

Si puede evaluarse matemáticamente sin ambigüedad, hacerlo.

Si no:

UNKNOWN / REVIEW_REQUIRED

según diseño.

============================================================
22. "INTERVALO CORTO"
============================================================

Si V5 usa un concepto de:

intervalo corto establecido para este efecto

pero no existe duración numérica disponible en fuentes suministradas:

NO inventar minutos.

Registrar dependencia/ambigüedad.

Las llamadas claramente separadas por >=6h pueden evaluarse donde la regla
sea explícita.

Cualquier criterio faltante:

UNKNOWN / BLOCKED_BY_MISSING_SOURCE.

============================================================
23. V5 5.3 — SOLICITUD DEL ESTUDIANTE
============================================================

Formalizar:

solicitud previa al inicio;

solicitud posterior al inicio;

D35/D53 cuando aplique;

retención;

ausencia de gestión de retención;

ventana de ajustes;

20 días;

actividad/bienvenida cuando corresponda.

Separar cada subregla.

No construir una gran función:

evaluateStudentRequestEverything().

============================================================
24. D35 / D53
============================================================

V5 referencia fuentes adicionales.

Cuando una subregla dependa del contenido de:

Anexo 5

GDM_GAM_PRD_MXL_008 Procedimiento D53

u otra fuente no proporcionada:

rule status:

BLOCKED_BY_MISSING_NORMATIVE_SOURCE

o representación equivalente.

No inventar.

Las porciones de 5.3 explícitas en el documento principal sí pueden
formalizarse hasta donde sean autosuficientes.

============================================================
25. V5 5.4 — CAMBIO DE CICLO
============================================================

Formalizar solamente contenido autosuficiente.

Si una condición depende de:

GCE_GCE_PRD_MXL_001

y no está disponible:

bloquear únicamente esa rama.

No bloquear todo el Rule Engine.

============================================================
26. V5 5.5 — ERROR DE INSCRIPCIÓN
============================================================

Formalizar condiciones explícitas del documento principal.

Mantener dependencia externa separada cuando corresponda.

============================================================
27. V5 5.6 — PROMESA DE VENTA NO CUMPLIDA
============================================================

Formalizar:

manifestación del estudiante;

relación causal con promesa;

evidencia de información errónea/falsa/tendenciosa/no alineada;

rechazo de beneficios/ajustes cuando corresponda;

validación de venta;

registro oficial;

LATAM;

casos excepcionales;

escalamientos.

No reducir todo a:

studentClaimsPromise == true.

Necesitamos las condiciones exactas.

============================================================
28. EVIDENCIA OFICIAL
============================================================

Cuando V5 exige que evidencia esté registrada en sistemas oficiales:

usar Facts observables sobre existencia/ubicación de evidencia.

No asumir:

archivo subido a Cancelaciones AI

=

evidencia oficialmente registrada.

Esos son conceptos distintos.

============================================================
29. V5 5.7 — DOCUMENTOS
============================================================

Formalizar reglas autosuficientes.

Importante:

si en bimestre inicial ya existen calificaciones:

la regla expresa que no debe considerarse cancelación de venta y debe ser
baja.

Implementar esta exclusión con trazabilidad explícita.

No permitir que una regla posterior la ignore silenciosamente.

============================================================
30. EXCLUSIONS / PRECEDENCE
============================================================

Necesitamos distinguir:

EXPLICIT_POLICY_PRECEDENCE

de:

OWNER_OPERATIONAL_PRECEDENCE.

Si el propio procedimiento dice:

"por ningún motivo podrá..."

esto puede representar exclusión/precedencia explícita.

Documentarlo con cita.

No convertirlo en prioridad numérica arbitraria.

============================================================
31. V5 5.8 — ILOCALIZABLES
============================================================

Formalizar cuidadosamente.

No crear una regla única gigante.

Separar componentes:

A. gestión de intentos conforme 5.2

B. ventana temporal

C. ausencia de contacto

D. actividad académica

E. criterios por tipo/nivel

F. contacto posterior por áreas relevantes

G. acciones obligatorias cuando existe contacto

H. BOT/Asistente Virtual

I. contacto efectivo

J. criterios específicos posgrado

K. incumplimiento de EE

============================================================
32. ILOCALIZABLE — LICENCIATURA
============================================================

Usar facts observables:

evaluation mode selection

platform accesses

access dates

access duration

grades

etc.

No dejar que LLM decida:

isIlocalizable.

============================================================
33. ILOCALIZABLE — POSGRADOS / EJECUTIVAS / ALIANZAS / DIPLOMADOS
============================================================

Formalizar cada nivel según V5.

No aplicar criterios de licenciatura universalmente.

Program level/type debe formar parte de la evaluación.

UNKNOWN si no sabemos el nivel y éste cambia la regla.

============================================================
34. CONTACTO EFECTIVO
============================================================

Construir la definición mediante Facts componentes.

Por ejemplo:

titular

interacción

objetivo informado

universidad identificada

ciclo informado

datos confirmados

etc.

No extraer simplemente:

effectiveContact = true

desde LLM.

El Rule Engine deriva el cumplimiento.

============================================================
35. V5 5.9 — CANCELACIONES OPERATIVAS
============================================================

Formalizar escenarios individualmente.

Entre ellos:

Servicios Escolares

Finanzas/Cobranza

incidencias de sistemas

falta de canalización

seguimiento EE

paquete de venta

Back Office.

Cada escenario debe tener:

ruleId propio
facts requeridos
outcome effect
trace.

============================================================
36. INCIDENCIAS DE SISTEMA
============================================================

Cuidado con el texto de V5.

No asumir que cualquier incidencia produce cancelación operativa.

Formalizar exactamente:

incidencia
responsabilidad de seguimiento
evidencia
intención del estudiante

y outcome correspondiente según texto.

============================================================
37. V5 5.10 — MYSTERY SHOPPER
============================================================

Formalizar el outcome explícito:

cancelación de matrícula

cuando sea aplicable.

Distinguirlo de:

cancelación de venta.

============================================================
38. V5 5.11 — FALTA DE QUÓRUM
============================================================

Formalizar:

grupo no aperturado por falta de quórum;

alternativa de reprogramación/cambio;

rechazo;

ausencia de inicio académico efectivo;

fecha de solicitud según criterio explícito.

No exigir automáticamente la ventana general de primeras dos semanas si
5.11 explícitamente establece una excepción.

Esto debe documentarse como explicit policy precedence si corresponde.

============================================================
39. V5 5.12 — INDICADOR
============================================================

Clasificar qué partes son:

INFORMATIONAL_ONLY

y cuáles realmente cambian una decisión individual.

No convertir KPI/reporting en Rule Engine de outcome si no corresponde.

============================================================
40. V5 5.13 — SOPORTE DE EVIDENCIA
============================================================

Formalizar requisitos de evidence sufficiency sólo donde realmente afecten
la validación individual.

No mezclar requisitos documentales con outcome sin soporte textual.

============================================================
41. V5 5.14 / 5.15
============================================================

Distinguir:

SLA / operación

vs

outcome normativo.

No toda regla del procedimiento tiene que contribuir al resultado
Cancelación/Baja.

El motor puede evaluar reglas:

OUTCOME
PROCESS_COMPLIANCE
EVIDENCE_REQUIREMENT
INFORMATIONAL

o clasificación equivalente.

============================================================
42. RULE CATEGORIES
============================================================

Cada regla debe declarar categoría.

Ejemplo:

OUTCOME_RULE

EXCLUSION_RULE

PROCESS_RULE

EVIDENCE_RULE

SLA_RULE

INFORMATIONAL_RULE

Esto evita que una regla de SLA determine por accidente el outcome.

============================================================
43. MISSING DATA
============================================================

Implementar clasificación:

NON_BLOCKING
IMPORTANT
BLOCKING

Cada missing datum debe explicar:

factType
rulesAffected
whyNeeded
severity

No responder simplemente:

"faltan datos".

============================================================
44. RESULTADO AUN CON DATOS FALTANTES
============================================================

El OWNER quiere que el sistema intente decidir.

Por tanto:

si existe soporte suficiente para un resultado pese a faltantes no
bloqueantes:

producir suggestedOutcome.

Ejemplo conceptual:

suggestedOutcome = CANCELACION_VENTA

missingData = [...]

reviewRequired = true/false

No convertir cualquier UNKNOWN en INDETERMINADO.

============================================================
45. INDETERMINADO
============================================================

Usarlo cuando falta información realmente necesaria para distinguir entre
resultados relevantes.

Debe indicar:

qué hechos faltan

qué reglas dependen de ellos

qué evidencia podría resolverlos.

============================================================
46. CONFLICT MODEL
============================================================

Crear detección de conflictos.

Ejemplos:

dos OUTCOME_RULE satisfechas generan outcomes incompatibles;

una OUTCOME_RULE y una EXCLUSION_RULE colisionan;

dos fuentes/branches aplicables conducen a resultados distintos.

Nunca esconder conflicto seleccionando silenciosamente una.

============================================================
47. EXPLICIT POLICY PRECEDENCE
============================================================

Si la política resuelve explícitamente el conflicto:

registrar:

precedenceType =
EXPLICIT_POLICY

source citation

reason

No usar prioridad numérica opaca.

============================================================
48. OWNER OPERATIONAL PRECEDENCE
============================================================

Puede existir infraestructura/modelo para:

OWNER_OPERATIONAL_PRECEDENCE.

Pero:

NO crear ninguna de oficio.

Sólo reglas aprobadas explícitamente por OWNER.

Debe quedar separada de policy source.

Campos conceptuales:

id
rulesInvolved
resolution
reason
approvedBy
approvedAt
version
active

============================================================
49. SI NO HAY PRECEDENCIA
============================================================

Mostrar:

CONFLICT

y:

REVIEW_REQUIRED.

Puede existir outcome tentativo sólo si está claramente etiquetado como tal
y existe fundamento suficiente.

No pretender que el conflicto no existe.

============================================================
50. OUTCOMES V5
============================================================

Utilizar exclusivamente:

docs/policy/outcome-inventory.md

actualizado en Phase 5.

NO inventar enum desde este prompt.

Asegurar que conceptos distintos permanezcan distintos, por ejemplo cuando
la fuente diferencie:

Cancelación de Venta

Baja

Cancelación de Venta Operativa

Cancelación de Matrícula

Retención / proceso de retención

u otros outcomes explícitos.

============================================================
51. AGGREGATOR
============================================================

Separar:

RULE EVALUATION

de:

OUTCOME AGGREGATION.

Primero evaluar todas las reglas aplicables.

Después combinar resultados.

No hacer:

if X return CANCELACION
else if Y return BAJA

que impida ver reglas posteriores/conflictos.

============================================================
52. ENGINE RESULT
============================================================

Modelo conceptual:

{
  policyCode,
  policyVersion,
  rulesFingerprint,
  factsFingerprint,

  evaluatedRules,

  satisfiedRules,
  unknownRules,
  notApplicableRules,

  missingData,

  conflicts,

  suggestedOutcome,

  outcomeStatus:
    DETERMINED |
    DETERMINED_WITH_WARNINGS |
    CONFLICTED |
    INDETERMINATE,

  reviewRequired,

  decisiveRules,

  supportingRules,

  exclusions,

  trace
}

Adaptarlo si existe un modelo mejor.

============================================================
53. MACHINE DECISION IMMUTABILITY
============================================================

Persistir la decisión de máquina.

No sobrescribir después.

Campos conceptuales:

machineOutcome
machineOutcomeStatus
machineReasoning
rulesFingerprint
factsFingerprint
policyVersion
createdAt

En fases posteriores:

humanDecision

será separado.

============================================================
54. ENGINE RUN
============================================================

Crear migración aditiva.

Conceptualmente:

engine_runs

Debe referenciar:

auditId
factRunId
policyCode
policyVersion
rulesFingerprint
factsFingerprint
status
suggestedOutcome
outcomeStatus
reviewRequired
createdAt

============================================================
55. RULE RESULTS
============================================================

Persistir resultados por regla.

Puede ser:

engine_rule_results

Campos:

engineRunId
ruleId
ruleStatus
category
outcomeEffect
conditionResults
factRefs
evidenceRefs
missingFacts
sourceCitation

No duplicar PII innecesariamente.

============================================================
56. IDEMPOTENCIA
============================================================

Mismos:

factRun frozen
policyVersion
rulesFingerprint

→ misma operación lógica.

No crear engine run duplicado por doble click.

Fingerprint conceptual:

factRun fingerprint
+
policyCode
+
policyVersion
+
rulesFingerprint
+
ownerPrecedenceVersion si aplica

============================================================
57. NO IA
============================================================

RUN_POLICY no llama:

OpenRouter
AssemblyAI
Vision
OCR.

CERO costo IA.

El motor trabaja exclusivamente con Facts ya persistidos.

Si falta un Fact:

UNKNOWN.

No:

"preguntarle al LLM qué cree".

============================================================
58. JOB
============================================================

Puede existir:

RUN_POLICY

usando jobs Phase 3.

La evaluación pura debería ser rápida, pero usar job permite mantener
orquestación uniforme.

No es obligatorio si una operación síncrona segura y corta resulta más
simple.

Documentar decisión.

No construir segunda cola.

============================================================
59. API
============================================================

Crear endpoints/rutas equivalentes a:

POST /api/audits/{auditId}/policy/run

GET /api/audits/{auditId}/policy

GET /api/audits/{auditId}/policy/{engineRunId}

No confiar en IDs sin validar auditoría/usuario.

============================================================
60. UI — RESULTADO
============================================================

Después de:

Facts congelados

mostrar acción:

EVALUAR POLÍTICA

Resultado:

RESULTADO SUGERIDO

ESTADO

REQUIERE REVISIÓN

REGLAS DETERMINANTES

DATOS FALTANTES

CONFLICTOS

EVIDENCIA

FUENTE NORMATIVA

============================================================
61. UI — RULE EXPLORER
============================================================

Cada regla evaluada:

ID

Sección

Página

Estado

Condiciones

Facts usados

Evidencias

Outcome effect

UNKNOWN reason

Blocked source

Click en evidencia:

abrir artifact/source correspondiente.

============================================================
62. UI — NO PDF TODAVÍA
============================================================

NO generar todavía Dictamen.pdf final.

Podemos mostrar toda la información necesaria para validarlo.

Phase 7 tomará MACHINE DECISION + evidence selection y rellenará la plantilla.

No mezclar problemas:

primero asegurarnos de que decide correctamente.

============================================================
63. HISTORICAL NORMATIVE SHADOW EVALUATION
============================================================

Phase 5 ya puede comparar Facts.

Ahora extender shadow evaluation.

Después de MACHINE DECISION:

comparar:

AI NORMATIVE OUTCOME

contra:

HUMAN HISTORICAL OUTCOME.

Sólo cuando exista human reference.

============================================================
64. TERMINOLOGÍA
============================================================

Nombre de métrica:

HISTORICAL OUTCOME AGREEMENT

NO:

POLICY ACCURACY.

Porque el humano puede estar equivocado.

============================================================
65. COMPARISON STATES
============================================================

Outcome comparison:

MATCH

DIFFERENT

HUMAN_OUTCOME_MISSING

AI_INDETERMINATE

AI_CONFLICTED

NOT_COMPARABLE

============================================================
66. DIFFERENCE CLASSIFICATION — NORMATIVE
============================================================

Permitir clasificar una discrepancia como:

EXTRACTION_ERROR

RULE_ENGINE_ERROR

MISSING_EVIDENCE

HUMAN_REFERENCE_ERROR

AMBIGUOUS_POLICY

MISSING_NORMATIVE_SOURCE

OWNER_PRECEDENCE_NEEDED

POLICY_VERSION_MISMATCH

EXPECTED_DIFFERENCE

OTHER

============================================================
67. GOLDEN CANDIDATES
============================================================

Un histórico puede convertirse en candidato:

POLICY_VALIDATED_GOLDEN_CASE

solamente si OWNER/revisor confirma que:

Facts relevantes fueron validados

policyVersion correcta

outcome correcto según fuente

no hay dependencia faltante que cambie resultado.

No promover automáticamente sólo porque AI y humano coinciden.

============================================================
68. REGRESSION
============================================================

Cuando una discrepancia sea:

RULE_ENGINE_ERROR

y exista corrección validada:

crear candidato a regression test normativo.

Test debe incluir:

facts sintéticos/anonimizados

policyVersion

expected rule statuses

expected outcome

source citations.

Nunca meter PII real en Git.

============================================================
69. TESTS POR REGLA
============================================================

Cada regla productiva debe tener tests.

Como mínimo:

happy path

condition false

condition unknown

boundary values

exception/exclusion cuando exista

missing normative dependency cuando aplique.

============================================================
70. TRACEABILITY MATRIX
============================================================

Actualizar:

docs/policy/traceability-matrix.md

Debe incluir:

source section
ruleId
implementation file
test file
facts used
status

Y reverse trace:

implementation rule
→ source.

============================================================
71. NO TEST SIN FUENTE
============================================================

Todo expected normativo debe justificar:

document
version
section
page.

Si no:

el test no puede presentarse como policy test.

============================================================
72. MISSING SOURCES
============================================================

Mantener dependencias V5.

Entre ellas pueden estar:

Anexo 1 matriz de validaciones
Anexo 2 Matriz Estrategias de Retención
Anexo 3 flujo y botones Flokzu
Anexo 4 Retención - Copiloto
Anexo 5 D53
Anexo 6 oficinas virtuales
Anexo 7 OPM
Anexo 8 Manual tickets CV
Documentos de Ingreso
Matriz extemporáneos
GCE_GCE_PRD_MXL_001
GDM_GAM_PRO_MXL_001
GDM_GAM_PRD_MXL_008

NO buscarlas fuera.

============================================================
73. BLOCKED RULES
============================================================

Una fuente faltante NO bloquea todo engine.

Regla individual puede tener:

BLOCKED_BY_MISSING_NORMATIVE_SOURCE.

El resultado global evalúa si esa regla bloqueada es:

NON_BLOCKING
IMPORTANT
BLOCKING

para el caso concreto.

============================================================
74. V2
============================================================

No necesitas necesariamente implementar 100% V2 en esta fase si el producto
nuevo operará inicialmente V5.

Pero la arquitectura DEBE soportarla y preservar datos.

Implementar V2 sólo hasta donde sea necesario para:

- reproducibilidad;
- tests de aislamiento/versioning;
- históricos seleccionados;

sin retrasar innecesariamente V5.

Documentar cobertura.

============================================================
75. V5 PRIMERO
============================================================

La prioridad productiva es:

V5.

Implementar cobertura amplia de las reglas V5 autosuficientes.

No bloquear Phase 6 únicamente porque anexos no proporcionados impidan
ciertas ramas.

Marcar esas ramas explícitamente.

============================================================
76. COVERAGE REPORT
============================================================

Crear:

docs/policy/v5-coverage.md

Para cada sección/regla:

IMPLEMENTED

BLOCKED_MISSING_SOURCE

AMBIGUOUS

INFORMATIONAL_ONLY

NOT_YET_IMPLEMENTED

Cada NOT_YET_IMPLEMENTED debe justificar por qué.

PASS no permite dejar reglas autosuficientes críticas sin implementar sólo
por tiempo.

============================================================
77. TEST REAL CON EXPEDIENTE
============================================================

Esta fase debe permitir probar al menos UN expediente privado real si OWNER
lo proporciona.

Flujo:

upload evidence

process

extract facts

review/freeze facts

run policy V5

inspect decision

compare human outcome

El dictamen humano sólo entra después del freeze.

============================================================
78. SI NO HAY EXPEDIENTE REAL DISPONIBLE
============================================================

Utilizar fixture sintético representativo.

No inventar que se hizo validación real.

Reportar claramente:

REAL CASE NOT EXECUTED

si corresponde.

============================================================
79. PRIMERA VALIDACIÓN MANUAL
============================================================

La UI debe permitir que OWNER diga:

AI outcome correcto

Human outcome correcto

Neither / ambiguous

Missing evidence

Missing policy source

No usar esto para modificar automáticamente reglas.

Crear feedback persistido.

============================================================
80. COST
============================================================

RUN_POLICY cuesta:

$0 API

Mostrarlo si la UI de costo lo requiere.

No crear AI usage artificial.

============================================================
81. SECURITY
============================================================

No PII en logs.

Machine reasoning debe referenciar IDs/facts.

Evitar copiar transcripts completos en:

engine_rule_results.

Guardar refs.

RLS:

engine runs visibles sólo para auditorías autorizadas.

============================================================
82. AUDIT LOG
============================================================

Eventos:

POLICY_EVALUATION_STARTED

POLICY_EVALUATION_COMPLETED

POLICY_EVALUATION_CONFLICTED

POLICY_EVALUATION_INDETERMINATE

NORMATIVE_SHADOW_COMPARISON_CREATED

NORMATIVE_DIFFERENCE_CLASSIFIED

GOLDEN_CANDIDATE_MARKED

No meter contenido sensible.

============================================================
83. DOCUMENTACIÓN
============================================================

Crear:

docs/adr/012-policy-engine.md

docs/adr/013-policy-version-runtime.md

docs/architecture/policy-engine.md

docs/architecture/outcome-aggregation.md

docs/policy/v5-coverage.md

docs/testing/policy-testing.md

docs/testing/normative-shadow-evaluation.md

docs/security/phase-6-security-review.md

docs/reports/phase-6-report.md

docs/phase-prompts/phase-7.md

Actualizar:

docs/architecture/data-model.md

docs/policy/rule-inventory.md

docs/policy/traceability-matrix.md

docs/policy/conflicts.md

docs/policy/ambiguities.md

docs/phases/roadmap.md

============================================================
84. PHASE 7
============================================================

Phase 7 será:

OFFICIAL DICTAMEN GENERATION + HUMAN REVIEW.

Tomará:

Frozen Fact Run

Machine Decision

Rule Trace

Evidence References

y generará:

Dictamen.pdf

usando la plantilla canónica.

Además:

human approve/override

machine decision preserved

final PDF.

NO implementar Phase 7 ahora.

============================================================
85. DICTAMEN TEMPLATE
============================================================

No tocar la plantilla todavía salvo análisis/documentación.

Recordar:

Dictamen.pdf determina CÓMO se entrega.

NO determina la política.

Phase 7 usará el template canónico ya registrado.

============================================================
86. MIGRACIONES
============================================================

Aditivas únicamente.

No modificar migrations previas.

Posibles estructuras:

engine_runs

engine_rule_results

policy_precedences

normative_shadow_comparisons

normative_feedback

Simplificar si puede hacerse con menos tablas.

============================================================
87. VALIDACIÓN DB
============================================================

Aplicar migraciones en InsForge real.

Verificar:

constraints
RLS
RPCs
foreign keys
idempotency.

Limpiar fixtures sintéticos.

============================================================
88. TESTS DE CONCURRENCIA / IDEMPOTENCIA
============================================================

Dos solicitudes simultáneas:

same factRun
same policy
same rulesFingerprint

→ una operación lógica.

No duplicar machine decisions.

============================================================
89. REPRODUCIBILIDAD
============================================================

Engine Run debe poder reconstruirse con:

policyCode
policyVersion
rulesFingerprint
factRunId
factsFingerprint
ownerPrecedenceVersion

Si el código cambia después:

la corrida histórica sigue indicando qué set produjo el resultado.

============================================================
90. VALIDACIONES OBLIGATORIAS
============================================================

Ejecutar:

pnpm lint
pnpm typecheck
pnpm test
pnpm build

Además:

DB migration validation
policy coverage validation
traceability validation
idempotency test
policy version isolation test.

============================================================
91. DEFINITION OF DONE
============================================================

Phase 6 sólo puede PASS si:

[ ] pure policy engine existe

[ ] version-aware

[ ] V5 rule set implementado

[ ] reglas citan fuente exacta

[ ] rule categories implementadas

[ ] TRUE/FALSE/UNKNOWN/NOT_APPLICABLE

[ ] missing data severity

[ ] conflicts

[ ] explicit policy precedence

[ ] no precedencias inventadas

[ ] outcomes derivados del inventory

[ ] deterministic aggregation

[ ] machine decision persistida

[ ] engine run idempotente

[ ] complete trace

[ ] rules fingerprint

[ ] facts fingerprint

[ ] blocked missing-source rules

[ ] V5 coverage report

[ ] UI de resultado

[ ] rule explorer

[ ] evidence navigation

[ ] normative shadow comparison

[ ] historical outcome agreement

[ ] discrepancy classification

[ ] regression candidate support

[ ] V2/V5 isolation test

[ ] real/synthetic end-to-end case

[ ] migration real

[ ] lint PASS

[ ] typecheck PASS

[ ] tests PASS

[ ] build PASS

[ ] phase-6-report.md

[ ] phase-7.md autocontenido

============================================================
92. PASS_WITH_WARNINGS
============================================================

Aceptable únicamente para:

anexos OWNER faltantes

ambigüedades reales de política

casos históricos sin policyVersion verificable

ausencia de expediente privado para smoke

siempre que:

las reglas afectadas estén identificadas y no inventadas.

NO aceptable:

rule without citation

UNKNOWN tratado como false

LLM decidiendo outcome

una sola rule function gigantesca sin trace

V5 hardcodeada sin versioning

conflictos ocultos

machine decision overwritten

tests fallan

============================================================
93. BLOCKED
============================================================

BLOCKED si:

el motor usa IA para decidir

una regla productiva no tiene fuente

se inventan reglas faltantes

se usa histórico como policy

V2 se sobrescribe

engine no es determinista

no existe trace

conflicts se resuelven silenciosamente

missing normative source se ignora

build/test/typecheck falla

============================================================
94. PHASE 6 REPORT
============================================================

Crear:

docs/reports/phase-6-report.md

Formato mínimo:

# Phase 6 Report

## Estado

## Policy Engine Architecture

## Policy Versions

## V5 Rule Set

## V2 Support

## Rules Fingerprint

## Rule Categories

## Outcome Inventory

## Rule Evaluation

## Tri-State / Four-State Conditions

## Business Days

## Date Boundaries

## 5.2 Contact Attempts

## 5.3 Student Request

## 5.4 Cycle Changes

## 5.5 Enrollment Error

## 5.6 Unfulfilled Sales Promise

## 5.7 Documents

## 5.8 Unreachable Students

## 5.9 Operational Cancellations

## 5.10 Mystery Shopper

## 5.11 Quorum

## 5.12 Indicator

## 5.13 Evidence Support

## 5.14 Evidence Requests

## 5.15 SLA

## Missing Normative Sources

## Blocked Rules

## Missing Data

## Conflicts

## Explicit Policy Precedence

## Owner Operational Precedence

## Outcome Aggregation

## Machine Decision

## Traceability

## Persistence

## Engine Idempotency

## UI

## Rule Explorer

## Normative Shadow Evaluation

## Historical Outcome Agreement

## Tests

## Policy Coverage

## Database Validation

## Lint

## Typecheck

## Build

## Real / Synthetic Case

## Risks

## Limitations

## Blockers

## Technical Debt

## Phase 7 Readiness

## Next

docs/phase-prompts/phase-7.md

============================================================
95. RESPUESTA FINAL
============================================================

Responder:

PHASE 6 RESULT:
PASS | PASS_WITH_WARNINGS | BLOCKED

POLICY ENGINE:
...

POLICY VERSION:
...

V5 COVERAGE:
...

V2 SUPPORT:
...

RULES:
...

MISSING SOURCES:
...

MISSING DATA:
...

CONFLICTS:
...

OUTCOME:
...

TRACEABILITY:
...

NORMATIVE SHADOW:
...

REAL CASE:
...

TESTS:
...

VALIDATIONS:
lint:
typecheck:
test:
build:

DATABASE:
...

SECURITY:
...

RISKS:
...

LIMITATIONS:
...

BLOCKERS:
...

PHASE 7 READINESS:
...

NEXT:
docs/phase-prompts/phase-7.md

REMEDIATION:
<si aplica>

============================================================
96. REGLA FINAL
============================================================

Phase 6 tiene una misión:

TOMAR HECHOS YA EXTRAÍDOS Y APLICAR EXACTAMENTE LA POLÍTICA.

La IA NO decide.

Los históricos NO deciden.

El legacy NO decide.

El Rule Engine decide usando únicamente:

Facts
+
Policy Version
+
Rules trazadas a fuentes oficiales
+
precedencias explícitas autorizadas.

Antes de PASS debes poder abrir cualquier resultado y responder:

¿Qué outcome produjo?

¿Qué regla lo produjo?

¿Dónde está esa regla en V5?

¿Qué condiciones evaluó?

¿Qué Facts utilizó?

¿De qué evidencia salió cada Fact?

¿Qué condiciones eran UNKNOWN?

¿Qué datos faltaban?

¿Hubo conflicto?

¿Cómo se resolvió?

¿La precedencia estaba escrita en política o fue OWNER-approved?

¿Podemos ejecutar exactamente los mismos Facts otra vez y obtener el mismo
resultado?

¿El resultado histórico del humano coincide?

Si no coincide:

¿sabemos dónde comienza la diferencia?

Si alguna respuesta depende de:

"el modelo creyó que..."

Phase 6 no está terminada.

Comienza ahora.

No avances a Phase 7 durante esta ejecución.