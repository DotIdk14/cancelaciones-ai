# ADR 001 - Arquitectura de aplicacion

## Estado

Aceptada como decision final de arquitectura base en Phase 1.

## Decision

Usar monorepo TypeScript con monolito modular. La aplicacion base sera Next.js full-stack sobre Vercel, con InsForge para auth, database y storage.

## Motivo

El uso esperado es bajo y secuencial. Next.js full-stack reduce complejidad frente a React + API separada porque permite server components, server actions, route handlers y middleware de auth en una sola app desplegable. Microservicios, colas externas complejas o infraestructura distribuida agregarian costo y mantenimiento innecesarios.

## Consecuencias

- Menos piezas operativas.
- Separacion interna por paquetes para mantener testabilidad.
- Jobs durables en base de datos para procesos largos.
- Auth y proteccion de rutas se implementan server-side.
