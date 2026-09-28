/**
 * `@cancelaciones/evidence` deja cada evidencia en un estado consultable por el
 * agente. Nada más: no hay reglas, ni hechos canónicos, ni motor normativo, ni
 * decisión de negocio. Su salida es texto y un estado, y quien llama persiste.
 *
 * No importa de `apps/web`, de InsForge, de OpenRouter ni de AssemblyAI: todo
 * entra por los puertos de `ports.ts` y por `config`. Por eso se puede probar
 * entero sin red y sin dobles de librerías externas.
 */

export * from './ports';
export * from './text';
export * from './pdf';
export * from './vision';
export * from './audio';
export * from './prepare';
