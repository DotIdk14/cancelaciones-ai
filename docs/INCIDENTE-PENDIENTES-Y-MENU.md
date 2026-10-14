# Corrección de pendientes y panel contextual · 14 de octubre de 2026

Se reprodujo el error con lecturas de la base productiva, sin modificar datos ni ejecutar IA. La página de 51 expedientes funcionaba; una página de 100 fallaba en `/api/database/records/case_reviews`, cuya URL tenía 3995 caracteres. El gateway devolvía HTML con 502 y el SDK lo trasladaba como error genérico.

La preparación de resúmenes ahora divide todas las consultas relacionadas por grupos de 40 identificadores, conservando la página completa y los filtros de bandeja. La lectura real de 100 expedientes terminó correctamente después del cambio. La condición de cierre de paginación de auditorías verifica los casos del lote actual, sin confundirlos con los lotes ya procesados. Un fallo HTML del servicio se traduce a un mensaje de servicio no disponible (503); no se imprime HTML interno en pantalla.

En `72e8177` ya estaban las reglas CSS del dock flotante y de superposición. Para eliminar la dependencia restante del contenedor del expediente, el panel «Ver datos y dictamen» se monta mediante un portal en `document.body` y mantiene posición fija. El identificador accesible pertenece al diálogo real. Los otros diálogos conservan su montaje. El cierre mantiene borradores, foco y desplazamiento trabajado.

La prueba de regresión confirma que el diálogo no está dentro de la rejilla. Se conservan los ajustes previos de consumo gerencial, comparación, cronología y hechos. La aplicación local se levantó en 127.0.0.1:5173; la herramienta de navegador rechazó la apertura automática por política de URLs, por lo que no se declara una medición visual nueva. El enlace local permite al propietario revisarlo directamente.

No hay migraciones ni cambios de permisos, dictámenes o evidencias. Los archivos de pruebas y consultas temporales no forman parte del despliegue.
