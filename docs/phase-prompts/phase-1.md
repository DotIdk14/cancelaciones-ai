# ============================================================
# CANCELACIONES AI
# PHASE 1 - FUNDACION TECNICA Y PERSISTENCIA BASE
# ============================================================

Estas iniciando Phase 1 de Cancelaciones AI.

Phase 0 termino:

PASS_WITH_WARNINGS

Las advertencias corresponden principalmente a fuentes normativas faltantes.
Esto NO bloquea la fundacion tecnica.

NO debes implementar reglas normativas productivas en esta fase.

============================================================
1. CONTEXTO
============================================================

Cancelaciones AI es un asistente interno de auditoria.

Flujo final esperado:

SUBIR ARCHIVOS
-> AUDITAR
-> PROCESAMIENTO AUTOMATICO
-> RESULTADO
-> DICTAMEN.PDF
-> REVISION HUMANA

Fuentes conceptualmente separadas:

1. GDM_GAM_PRD_MLG_003 y fuentes oficiales
   = POLITICA

2. Dictamen.pdf
   = PLANTILLA CANONICA DE SALIDA

3. CaVe historicos
   = EJEMPLOS, NO POLITICA

4. Repo legacy
   = REFERENCIA TECNICA, NO POLITICA

Antes de hacer cambios lee obligatoriamente:

AGENTS.md
README.md
docs/reports/phase-0-report.md
docs/architecture/overview.md
docs/architecture/data-model.md
docs/architecture/background-processing.md
docs/legacy/assessment.md
docs/phases/roadmap.md

Las invariantes de AGENTS.md son obligatorias.

============================================================
2. OBJETIVO DE PHASE 1
============================================================

Crear una fundacion tecnica REAL sobre la cual puedan construirse las fases
posteriores sin tener que rehacer:

- arquitectura;
- autenticacion;
- persistencia;
- configuracion;
- modelo de datos;
- acceso a InsForge;
- estructura del monorepo;
- testing;
- seguridad basica.

Esta fase NO debe limitarse a crear carpetas y tipos TypeScript.

Al terminar debe existir una aplicacion minima pero funcional y persistente.

============================================================
3. PRINCIPIO DE ESTA FASE
============================================================

No quiero arquitectura ficticia.

No quiero:

"InsForge estara integrado posteriormente."

Quiero validar en esta fase hasta donde sea razonablemente posible:

APP
<-> AUTH
<-> DATABASE
<-> CONFIGURATION

El upload real de evidencias permanece fuera de scope.

============================================================
4. DECISION ARQUITECTONICA FINAL
============================================================

Phase 0 dejo Next.js/Vercel como candidato preferido.

En esta fase debes cerrar la decision.

Evaluar brevemente:

A. Next.js full-stack
B. React + API separada

Teniendo en cuenta:

- Vercel;
- InsForge;
- jobs futuros;
- procesamiento asincrono;
- uploads;
- TypeScript;
- simplicidad;
- ~50 auditorias/dia;
- un usuario simultaneo inicialmente.

Preferir la opcion de MENOR COMPLEJIDAD que satisfaga los requisitos.

Documentar decision final en ADR.

No dejarla nuevamente como:

"por definir".

============================================================
5. MONOREPO
============================================================

Crear un monorepo pequeno.

Preferencia:

pnpm workspaces

salvo que exista una razon tecnica demostrable para otra alternativa.

NO anadir Turborepo unicamente por costumbre.

Ejemplo conceptual:

apps/
  web/

packages/
  domain/
  db/
  shared/

No crear todavia:

packages/ai
packages/policy-engine
packages/reporting

si solo contendran archivos vacios.

Pueden anadirse en las fases donde realmente aparezca codigo para ellos.

KEEP_IT_SIMPLE.

============================================================
6. APP WEB
============================================================

Crear aplicacion web minima.

Requisitos:

TypeScript strict
Tailwind CSS
ESLint
formateo consistente

Idioma de UI:

espanol.

Pantalla minima inicial:

Cancelaciones AI

Auditorias

Nueva auditoria

No es necesario implementar todavia el flujo completo.

La aplicacion debe poder ejecutarse localmente.

============================================================
7. INSFORGE - INTEGRACION REAL
============================================================

InsForge sera utilizado para:

AUTH
DATABASE
STORAGE

segun las capacidades reales disponibles.

No copies ciegamente la integracion legacy.

Primero inspeccionala.

Despues implementar una integracion limpia.

Crear un modulo server-side claramente separado para acceso a InsForge.

Nunca exponer credenciales privilegiadas al cliente.

============================================================
8. VALIDACION DE INSFORGE
============================================================

Si existen credenciales/configuracion disponibles:

VALIDAR REALMENTE:

- conexion;
- lectura DB;
- escritura DB;
- autenticacion;
- sesion;
- capacidades de storage necesarias posteriormente.

No es necesario subir evidencia real todavia.

Puede utilizarse un objeto/registro sintetico de prueba.

Si no existen credenciales:

NO inventarlas.

La fase puede quedar:

PASS_WITH_WARNINGS

pero debe existir:

docs/setup/insforge.md

explicando exactamente:

- variables necesarias;
- donde obtenerlas;
- cuales son publicas;
- cuales son privadas;
- como verificar conexion;
- que validaciones quedan pendientes.

============================================================
9. VARIABLES DE ENTORNO
============================================================

Crear:

.env.example

Nunca:

.env
secrets reales
tokens
credenciales privadas

en Git.

Validar variables con schema.

Preferiblemente con una solucion simple.

Por ejemplo:

zod

si ya resulta razonable para el proyecto.

La aplicacion debe fallar de manera clara cuando falte configuracion
obligatoria server-side.

============================================================
10. AUTH
============================================================

Implementar autenticacion minima funcional con InsForge.

No necesitamos un RBAC complejo.

Roles iniciales:

AUDITOR
OWNER

El sistema inicialmente puede tener un unico usuario real.

Pero la arquitectura debe distinguir ambos permisos.

OWNER:

- administracion futura de fuentes normativas;
- administracion futura de precedencias operativas.

AUDITOR:

- auditorias.

No implementar todavia pantallas administrativas completas.

============================================================
11. PROTECCION DE RUTAS
============================================================

La aplicacion privada debe requerir sesion.

Como minimo:

/login

/auditorias

/auditorias/nueva

o estructura equivalente.

No confiar unicamente en ocultar elementos frontend.

La proteccion debe ser server-side donde corresponda.

============================================================
12. MODELO DE DATOS BASE
============================================================

Definir el esquema minimo necesario para soportar las proximas fases.

NO disenar toda la base futura.

Crear solamente las entidades que ya sabemos que seran necesarias.

Como minimo evaluar:

users / profiles

audits

evidence metadata

engine runs

ai usage

jobs

audit log

policy sources

report artifacts

Pero NO es obligatorio implementar todas ahora.

Determinar cuales deben existir fisicamente desde Phase 1 y cuales pueden
esperar.

Documentar la decision.

============================================================
13. AUDIT
============================================================

Debe existir persistencia real de una auditoria minima.

Conceptualmente:

Audit

id
status
createdAt
updatedAt
createdBy

No inventar aun campos normativos innecesarios.

La informacion extraida del estudiante llegara en fases posteriores.

Evitar tablas enormes con 50 columnas prematuramente.

============================================================
14. ESTADOS
============================================================

Definir estados minimos del lifecycle tecnico.

No mezclar todavia estados normativos.

Ejemplo conceptual:

DRAFT
READY
PROCESSING
COMPLETED
FAILED

No es obligatorio utilizar estos nombres.

Los estados de procesamiento definitivos se refinaran en Phase 3.

============================================================
15. IDS
============================================================

Usar IDs internos robustos.

El CaVe ID:

CaVe-30344

NO debe ser necesariamente primary key tecnica.

Debe poder almacenarse posteriormente como externalCaseId o equivalente.

============================================================
16. MIGRACIONES
============================================================

Toda estructura DB debe ser:

versionada
reproducible

No hacer cambios manuales irrepetibles en produccion.

Establecer desde esta fase el mecanismo oficial de migraciones del proyecto.

Documentarlo.

============================================================
17. TIPOS BASE
============================================================

Crear unicamente tipos que realmente se utilicen o que sean necesarios como
contratos de arquitectura.

Entre ellos pueden estar:

Audit
Evidence
Fact
Provenance
EngineRun
AIUsage
Job

Pero:

NO crear implementaciones vacias gigantes.

NO crear 40 interfaces hipoteticas.

Tipos de dominio deben mantenerse independientes de React.

============================================================
18. DOMAIN BOUNDARY
============================================================

El dominio futuro debe poder vivir sin:

React
Next.js
InsForge
OpenRouter
AssemblyAI
HTTP

No implementar todavia el rule engine.

Pero deja clara la frontera para que no terminemos introduciendo:

db calls
API clients
React state

dentro del dominio normativo.

============================================================
19. REPOSITORY / DATA ACCESS
============================================================

Evitar que componentes React hagan queries arbitrarias por toda la app.

Crear una capa sencilla y consistente de acceso a datos.

No implementar una arquitectura Enterprise exagerada.

Puede ser:

services
repositories
server modules

La prioridad es que el acceso a DB quede centralizado y testeable.

============================================================
20. STORAGE
============================================================

Preparar la integracion base de storage privado de InsForge.

NO subir evidencias reales todavia.

Validar:

- bucket/contenedor privado;
- estrategia de path;
- permisos;
- acceso server-side;
- URLs firmadas o mecanismo equivalente si existe.

Si no puede validarse sin credenciales:

documentar exactamente que falta.

Disenar path conceptualmente similar a:

audits/{auditId}/originals/{evidenceId}/...

pero NO comprometerlo sin revisar las capacidades reales de InsForge.

============================================================
21. PII
============================================================

No almacenar PII innecesaria en esta fase.

Tests:

datos sinteticos.

Seed:

datos sinteticos.

Screenshots:

ninguno real.

Historicos:

permanecen privados y fuera de Git.

Verificar .gitignore.

============================================================
22. AUDIT LOG BASE
============================================================

Crear la fundacion minima para audit log si encaja limpiamente en el modelo.

No implementar todos los eventos futuros.

Como minimo debe ser posible registrar posteriormente:

AUDIT_CREATED
EVIDENCE_UPLOADED
ENGINE_EXECUTED
HUMAN_REVIEWED

El audit log no debe disenarse como una tabla mutable de "estado actual".

Debe representar eventos.

============================================================
23. JOBS
============================================================

NO implementar todavia el worker durable completo.

Eso corresponde a Phase 3.

Pero:

NO disenar el modelo de datos de manera que despues obligue a rehacer toda
la aplicacion.

Puede definirse el contrato Job minimo y dejar implementacion fisica para
Phase 3 si es la opcion mas simple.

Documentar la decision.

============================================================
24. TESTING
============================================================

Crear infraestructura real de tests.

Necesitamos como minimo:

unit test
integration test cuando sea viable
smoke test de aplicacion

No crear tests falsos que unicamente hagan:

expect(true).toBe(true)

Debe existir por lo menos una prueba util.

Por ejemplo:

crear Audit
leer Audit
validar transicion basica

si DB de desarrollo esta disponible.

Si DB externa no esta disponible:

usar tests de dominio/config sin fingir una integracion que no existe.

============================================================
25. COMMANDS
============================================================

Debe existir una interfaz consistente desde la raiz.

Idealmente:

pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test

o equivalente justificado.

Todos deben funcionar desde el root.

============================================================
26. CI
============================================================

Agregar CI basico si puede hacerse sin complejidad innecesaria.

Por ejemplo GitHub Actions con:

install
lint
typecheck
test
build

No incluir deploy automatico todavia salvo que ya exista una razon clara.

============================================================
27. LEGACY REUSE
============================================================

Revisar docs/legacy/assessment.md.

Si Phase 0 marco componentes:

REUSE_AS_IS
o
REUSE_WITH_CHANGES

pueden recuperarse en esta fase SI pertenecen al scope.

Antes de copiar:

comparar dependencias;
seguridad;
acoplamiento;
calidad.

No copiar archivos enormes cuando solo hacen falta 20 lineas.

No arrastrar deuda accidental.

============================================================
28. UI LEGACY
============================================================

Puede reutilizarse:

Tailwind config
UI primitives
layout base

si Phase 0 determino que son adecuados.

NO traer todavia:

EvidenceViewer
CallPlayer
CallTranscript

si todavia no existe la funcionalidad que los necesita.

Evitar codigo muerto.

============================================================
29. SECURITY BASELINE
============================================================

Validar como minimo:

secrets server-side;
no privileged key en bundle;
auth enforcement;
storage private strategy;
PII fuera de logs;
safe error handling;
.env ignorado;
security headers razonables si corresponden.

No implementar un framework de seguridad gigantesco.

============================================================
30. ERROR HANDLING
============================================================

Establecer desde ahora un patron simple.

No mostrar:

stack traces;
secrets;
raw provider errors

al usuario.

Logs tecnicos si pueden conservar contexto necesario SIN PII innecesaria.

============================================================
31. NO IMPLEMENTAR EN ESTA FASE
============================================================

FUERA DE SCOPE:

uploads reales de evidencias

parsing PDFs

OCR

vision

OpenRouter

AssemblyAI

transcripcion

motor normativo

formalizacion de reglas

conflict resolver

precedencias

Dictamen.pdf generator

background worker completo

dashboard

analytics

integraciones Gmail

integraciones SIU

integraciones I6

integraciones Flokzu

============================================================
32. NO DUPLICAR
============================================================

Antes de crear:

auth client
db client
InsForge client
config loader
types
UI primitives

buscar si ya existe.

Debe existir UNA implementacion autoritativa.

============================================================
33. DOCUMENTOS A CREAR / ACTUALIZAR
============================================================

Actualizar o crear:

docs/adr/001-application-architecture.md

Debe quedar FINAL para la arquitectura base.

Crear:

docs/setup/local-development.md

docs/setup/insforge.md

docs/architecture/persistence.md

docs/security/phase-1-security-review.md

docs/reports/phase-1-report.md

docs/phase-prompts/phase-2.md

Actualizar:

docs/architecture/data-model.md

si Phase 1 demuestra que necesita ajustes.

NO modificar documentacion normativa salvo correccion demostrable.

============================================================
34. PHASE 2 PROMPT
============================================================

El prompt Phase 2 debe ser autocontenido.

Phase 2 sera:

INGESTA DE EVIDENCIA.

Debera construir sobre la infraestructura REAL creada aqui.

No escribir un Phase 2 que asuma cosas que Phase 1 no valido.

============================================================
35. VALIDACIONES OBLIGATORIAS
============================================================

Antes de declarar Phase 1 terminada ejecutar:

install limpio

lint

typecheck

tests

build

Ademas:

verificar git status

verificar que no existan:

.env
keys
tokens
PII nueva
archivos historicos reales
evidencias reales

versionadas accidentalmente.

============================================================
36. VALIDACION DE BUILD
============================================================

El build debe ejecutarse con una estrategia correcta respecto a secrets.

No hardcodear variables reales solo para hacer pasar build.

Distinguir:

build-time configuration

de

runtime configuration.

============================================================
37. DEFINITION OF DONE
============================================================

Phase 1 puede ser PASS solo si:

[ ] arquitectura final elegida y documentada
[ ] monorepo funcional
[ ] package manager definido
[ ] TypeScript strict
[ ] Tailwind
[ ] lint
[ ] tests
[ ] build
[ ] app en espanol
[ ] InsForge adapter implementado
[ ] auth baseline implementada o bloqueo externo documentado
[ ] DB baseline implementada
[ ] migraciones reproducibles
[ ] Audit persistible
[ ] env validation
[ ] .env.example
[ ] no PII en Git
[ ] storage strategy validada o limitacion documentada
[ ] security baseline revisada
[ ] documentacion actualizada
[ ] phase-1-report.md
[ ] phase-2.md autocontenido

============================================================
38. GATE
============================================================

PASS

si toda la fundacion necesaria para Phase 2 funciona realmente.

PASS_WITH_WARNINGS

unicamente si existe una limitacion EXTERNA no bloqueante, por ejemplo:

credenciales de un servicio no disponibles,

pero la arquitectura y codigo estan listos y el faltante esta claramente
documentado.

BLOCKED

si ocurre cualquiera de estos:

build falla

typecheck falla

tests fallan

persistencia fundamental no tiene diseno reproducible

autenticacion queda simulada sin advertirlo

secretos aparecen en cliente/Git

se introduce una segunda implementacion paralela

se construye una arquitectura que depende de memoria del proceso para datos
persistentes

============================================================
39. REMEDIATION
============================================================

Si Phase 1 termina BLOCKED:

crear:

docs/phase-prompts/remediation-phase-1.md

NO generar un Phase 2 ejecutable como si el bloqueo no existiera.

============================================================
40. FORMATO DE phase-1-report.md
============================================================

# Phase 1 Report

## Estado

## Arquitectura elegida

## Motivo

## Stack final

## Package Manager

## Monorepo

## App

## InsForge

## Auth

## Database

## Migrations

## Storage

## Data Model

## Audit Persistence

## Environment

## Security

## Legacy Reuse

## Tests

## Lint

## Typecheck

## Build

## CI

## Archivos creados

## Archivos modificados

## Comandos ejecutados

## Limitaciones

## Riesgos

## Blockers

## Technical Debt

## Proxima fase

docs/phase-prompts/phase-2.md

============================================================
41. RESPUESTA FINAL
============================================================

Al terminar responde:

PHASE 1 RESULT:
PASS | PASS_WITH_WARNINGS | BLOCKED

ARCHITECTURE:
...

STACK:
...

INSFORGE:
...

AUTH:
...

DATABASE:
...

STORAGE:
...

MIGRATIONS:
...

SECURITY:
...

LEGACY REUSE:
...

VALIDATIONS:
lint:
typecheck:
tests:
build:

FILES CREATED:
...

RISKS:
...

BLOCKERS:
...

NEXT:
docs/phase-prompts/phase-2.md

REMEDIATION:
<ruta si aplica>

============================================================
42. REGLA FINAL
============================================================

Phase 1 debe dejar una base REAL.

No quiero llegar a Phase 2 y descubrir que:

no existe persistencia confiable;
auth era un mock;
storage no esta disenado;
migraciones no existen;
o la arquitectura todavia estaba "por definir".

Pero tampoco conviertas esta fase en una plataforma enterprise.

La meta sigue siendo:

~50 auditorias/dia
~1 usuario inicial
monolito modular
simple
trazable
cercano a produccion.

Comienza Phase 1 ahora.

No avances a Phase 2 durante esta ejecucion.
