# Desarrollo local

Node >=22.12.0 y npm; CI usa Node 22 y el enlace Vercel declara 24.x. Ejecutar `npm ci`, copiar `.env.example` a `.env.local` y obtener credenciales del responsable. Confirmar INSFORGE_BASE_URL contra el proyecto enlazado: el ejemplo y AGENTS mencionan hosts históricos diferentes.

`npm run dev` monta Vite con `scripts/dev-api.mjs`. predev genera Policy: durante congelamiento normativo comparar hashes antes y después. `npm run preview` solo sirve dist, sin Functions. Login local requiere APP_URL y redirect autorizado en InsForge.

`npm run lint`, `npm test`, `npm run build` verifican el proyecto. `npm run verify:release` añade contratos. Las pruebas live requieren habilitación y credenciales, generan costes y no se ejecutan por esta limpieza. Ver [diagnóstico](troubleshooting.md).
