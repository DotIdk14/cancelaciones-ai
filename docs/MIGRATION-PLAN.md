# Plan de migración — Cancelaciones3 → arquitectura AI-native

> **Estado: completado en código.** Este documento es ahora histórico/consultivo.
> La arquitectura vigente está en [`docs/ARCHITECTURE.md`](ARCHITECTURE.md),
> el pipeline en [`docs/AUDIT_PIPELINE.md`](AUDIT_PIPELINE.md) y el runbook de
> cutover en [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

## Lo que queda vigente de este documento

- El diagnóstico del estado previo (motor normativo roto, tablas legacy) sigue
  siendo el contexto histórico.
- Las decisiones de arquitectura (1-12) ya están implementadas y documentadas en
  los archivos citados arriba.

## Lo que cambió después de este plan

- Se añadió autenticación/autorización completa: `app_memberships`, cookies
  httpOnly, `requireAuth`, roles `user`/`coordinator`. Ver
  [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) y `migrations/20261002000000_auth_core.sql`.
- El esquema de base de datos creció con `case_reviews`, `case_comparisons` y
  `app_memberships`. Ver [`docs/DATABASE.md`](DATABASE.md).

## Verificación pendiente en deploy

La lista original de verificación en deploy quedó obsoleta. Usar los checks
post-deploy de [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
