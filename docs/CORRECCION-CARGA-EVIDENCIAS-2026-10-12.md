# Corrección de carga de evidencias — 12 de octubre de 2026

## Causa observada y alcance

La captura del usuario muestra un error de lectura del navegador (`NotReadableError`), anterior a la petición HTTP. No demuestra rechazo de JPG ni una caída de Storage. La causa concreta en Windows (archivo movido, virtualizado, permiso revocado o referencia caducada) no puede determinarse con una captura.

Se encontró que el formulario liberaba el selector antes de leer los bytes. Ahora inicia una copia en memoria mientras conserva la selección, comunica la lectura y bloquea la creación hasta terminar. Los originales no se modifican. La copia se conserva por identidad para los reintentos. Las copias se acotan a 8 MiB y la espera a 15 segundos; el límite real de subida sigue siendo responsabilidad del servidor.

Los fallos de lectura tienen código `FILE_READ_ERROR` y explicación en español. Volver a seleccionar un archivo de igual nombre y tamaño reemplaza exclusivamente su referencia fallida de lectura. Los casos y originales ya guardados mantienen sus claves de idempotencia y no se vuelven a crear.

## Formatos

- Imágenes: PNG, JPG/JPEG/JPE/JFIF, WEBP y GIF. La firma real decide el MIME de estas imágenes también en el servidor, conservando nombre y bytes originales.
- Documentos: PDF.
- Audio: MP3, WAV, M4A, OGG y WEBM, con las restricciones existentes para contenedores ambiguos audio/video.
- Texto UTF-8: TXT, CSV, Markdown, JSON y LOG. Los alias de texto se normalizan a `text/plain`; los binarios camuflados siguen siendo rechazados antes de persistir.
- Alias adicionales: `image/jpg`, `image/pjpeg`, `image/x-png`, `audio/x-wav`, `audio/wave`, `audio/vnd.wave`, `audio/x-mp3`, `application/x-pdf`.

No se anuncia compatibilidad universal. HEIC, TIFF, BMP, SVG, Office y archivos comprimidos necesitan preparación específica que no se ha implementado en este cambio.

## Verificación

Regresiones automatizadas: pérdida posterior de acceso al original, conservación de bytes/nombre/fecha, ausencia de peticiones ante archivo ilegible, recuperación de lectura, clasificación de errores DOM, alias de MIME, extensiones de texto, corrección PNG/JPEG en el endpoint y rechazo de ejecutables/video disfrazado. Se conserva la suite de creación, cargas parciales e idempotencia.

No se reprodujo el fallo con los cuatro archivos reales del usuario; no se proporcionaron esos originales. No hubo escrituras de expedientes reales, cambios de esquema ni migraciones de InsForge.

El aviso `DEP0169` apareció en logs de peticiones HTTP exitosas. Se reprodujo el aviso usando el helper de consultas de la versión instalada de `@vercel/node`, que utiliza `url.parse()`. Los logs de producción no aportan stack, por lo que esa atribución es probable, no concluyente. El aviso es independiente del error de lectura del navegador y no se silenciaron warnings para ocultarlo.
