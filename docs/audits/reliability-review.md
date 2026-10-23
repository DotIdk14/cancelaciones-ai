> Informe histórico de fiabilidad: conserva hallazgos y limitaciones de su sesión. Para la entrega documental autorizada del 23/10 consultar [producción](production-release.md); esta reorganización no cambia los contratos ni certifica de nuevo precisión del modelo.

# Revisión de fiabilidad de las auditorías

Fecha: 22 de octubre de 2026. Base revisada: commit `a4504ab`.

## Diagnóstico de la versión revisada

El sistema valida la estructura de una respuesta, algunas coherencias internas y la existencia de los identificadores citados. No comprueba de forma independiente que el contenido de una evidencia implique la conclusión del modelo. La confianza es una autoestimación generada por ese mismo modelo y no una probabilidad de acierto calibrada.

La corrección anterior del prompt aborda una confusión específica de intención; no demuestra que las demás auditorías estén libres de errores de interpretación.

## Recorrido observado

1. `src/server/audit-service.ts::buildAuditInputs` prepara originales visuales, derivados textuales y transcripciones, conserva sus identificadores y agrega contexto administrativo cercado.
2. `src/skills/audit/execute.ts::buildAuditMessages` entrega el expediente y el procedimiento V5 completo al modelo.
3. `src/server/openrouter.ts` solicita un assessment JSON con temperatura 0. Los reintentos se activan por errores técnicos o de validación. Una respuesta que pasa esas comprobaciones puede terminar el transporte sin otra revisión semántica.
4. `src/skills/audit/schema.ts` verifica tipos, vocabulario, referencias requeridas, algunas relaciones temporales y condiciones internas específicas. `execute.ts::validateAssessmentReferences` verifica pertenencia de IDs al expediente.
5. `audit-service.ts` persiste el assessment como COMPLETED. Esa etiqueta corresponde a ejecución terminada; no certifica una revisión humana ni corrección semántica.
6. La UI presenta la confianza declarada por la IA. Calidad distingue coincidencia observada y confianza declarada, pero esa comparación no se usa para calibrar la confianza de cada dictamen nuevo.

## Hallazgos verificados

### Alto: una cita real puede sostener una interpretación falsa sin ser rechazada

En el incidente revisado, un mensaje sobre falta de llamada y dificultad de acceso se convirtió en una solicitud de no continuar. El ID de evidencia era real y la cita existía. La deducción adicional fue incorrecta.

Prueba sintética de diagnóstico, sin proveedor ni escrituras de producción: se agregó a un assessment de prueba un hecho que afirmaba una solicitud de cancelación y citaba «No sé cómo ingresar al aula. ¿Me ayudan?». `parseAiAuditAssessment` lo aceptó con confianza 0.99. Esta prueba acredita el hueco del validador; no mide la frecuencia de errores del modelo.

### Alto: la confianza no cuenta con una validación independiente

`facts[].confidence` y `audit.confidence` son números entre 0 y 1 elegidos por el generador. Algunas combinaciones incoherentes se rechazan, pero un valor alto no exige evidencia de calibración o una comprobación adicional de la conclusión. El porcentaje no debe interpretarse como probabilidad medida de acierto.

Consulta agregada de diagnóstico: 24 intentos COMPLETED no retirados, confianza declarada media de 0.883; 9 filas de revisión humana y 2 finalizadas. Son conteos de intentos y filas, no una muestra independiente ni una tasa de precisión. No permiten concluir que el sistema acierte el 88.3 %.

### Medio: las referencias normativas admiten texto libre

Una segunda prueba sintética cambió `audit.procedureSection` a `99.99`, conservando los demás requisitos del fixture válido. El parser lo aceptó. El prompt pide citar el procedimiento, pero no existe una comprobación integral de que cada sección e inciso citado exista en la fuente oficial.

### Medio: un check puede tener soporte formal y seguir siendo incorrecto

Los estados ACREDITADO y NO_ACREDITADO requieren IDs y valores observados. Esa comprobación no establece que se cumplan todas las condiciones del criterio. En el resultado del incidente se marcaban supuestos como acreditados mientras el razonamiento reconocía la ausencia de alguno de sus requisitos. La nueva instrucción los distingue, pero el respaldo semántico sigue dependiendo del modelo.

### Medio: cobertura de pruebas centrada en contratos

La suite fija ampliamente estructura, permisos, persistencia, temporalidad, referencias y recuperación. Los tests de prompt fijan presencia de instrucciones; no prueban que un modelo las obedezca. Los smoke tests con proveedor incluyen algunas expectativas semánticas, pero no constituyen una evaluación representativa de todas las causales con casos negativos y contradictorios.

### Riesgo de diseño: presión para cerrar una clasificación

Las instrucciones califican EVIDENCIA_INSUFICIENTE como último recurso y exigen una orientación provisional. Eso puede incentivar completar una explicación cuando faltan premisas. Es una hipótesis de riesgo a evaluar: la lectura de código no demuestra que esa frase haya causado por sí sola el incidente.

## Corrección de fondo recomendada

1. **Presentación honesta:** identificar la confianza como autoestimación no calibrada y separar ejecución terminada, propuesta de IA y revisión humana. No bajar porcentajes arbitrariamente ni presentarlos como garantía.
2. **Premisas trazables:** distinguir en el assessment observación, inferencia e información no determinable; para cada premisa decisiva registrar fuente, cita, localización, hablante y límites. La ausencia de una premisa no se rellena con el contexto del ticket.
3. **Control previo a publicación:** verificar que las premisas decisivas y las citas se sostengan mutuamente y que los requisitos reconocidos como ausentes no se presenten como acreditados. Una comprobación semántica independiente necesita evaluación propia; otra llamada a un modelo tampoco constituye garantía. Respetar el presupuesto total de intentos y espera.
4. **Referencias verificables:** comprobar la existencia de secciones e incisos contra el procedimiento owner-supplied. Esto valida citas; no introduce un motor de reglas ni reclasifica el dictamen en el backend.
5. **Evaluación semántica:** mantener casos sintéticos y negativos de soporte frente a cancelación, motivos personales frente a promesa incumplida, acceso frente a actividad válida y supuestos con varias condiciones. Evaluar por separado extracción, interpretación, aplicación normativa, abstención y exceso de confianza.
6. **Calibración:** contrastar confianza con resoluciones humanas revisadas en una muestra reservada, separando versiones y causales. Medir errores de alta confianza y tamaño de muestra; no convertir coincidencia con unas pocas decisiones en una probabilidad por expediente.

El procedimiento oficial se conserva. Estas medidas afectan la trazabilidad, validación y evaluación de la interpretación, no crean política a partir de casos históricos.

## Alcance de esta revisión

Inspección del código, contraste del incidente ya reportado, dos pruebas sintéticas de validación y consultas agregadas de solo lectura. Las pruebas de diagnóstico y las evidencias reales quedan fuera de Git. Este apartado registra el diagnóstico inicial; las correcciones posteriores se detallan abajo. No se ha realizado una calibración estadística.

## Correcciones implementadas después del diagnóstico

- Propuesta y revisión crítica en peticiones separadas, con máximo total de dos llamadas reales y deadline compartido. Cada petición reserva un intento; si una falla, no se publica la propuesta.
- La propuesta conserva el modelo configurado; el contraste usa OPENROUTER_REVIEW_MODEL (por defecto google/gemini-2.5-pro) y puede utilizar el tiempo restante del deadline compartido. Recibe también las incoherencias detectadas por el validador local. La segunda etapa puede confirmar, corregir o solicitar información. Debe justificar los hallazgos y registrar sustento para cada hecho final. Las inferencias se distinguen de las observaciones y los valores desconocidos quedan nulos.
- Verificación local de cobertura de hechos, pertenencia de IDs, citas en texto/transcripciones disponibles y existencia de referencias normativas en el índice documental del procedimiento original. La lectura de citas en imágenes depende de la revisión visual del modelo; no se declara comprobación mecánica de píxeles.
- Metadata aditiva `reliabilityReview`, costes reales agregados y pipeline versionado. Los históricos permanecen legibles sin atribuirles retroactivamente la nueva revisión.
- La autoestimación no se presenta como probabilidad medida de acierto. Se puede abrir el sustento contrastado y consultar el original desde la vista de hechos.

La revisión adicional puede seguir equivocándose, especialmente al usar la misma familia de modelo. Esta mejora introduce controles y trazabilidad, no una garantía de corrección ni una calibración estadística. La calibración requiere decisiones humanas suficientes y una muestra reservada; no se fabrican porcentajes a partir del pequeño historial disponible.

## Validación de entrega (22 de octubre de 2026)

La entrega permanece local y bloqueada para producción. Las pruebas con proveedor detectaron incompatibilidades reales: salida de información faltante frente a rechazo por 5.2, citas visuales en archivos que también incluyen texto auxiliar y comprobación de citas con varias secciones declaradas. Se ajustaron los contratos y validaciones; las citas puramente textuales siguen exigiendo coincidencia literal y las visuales dependen del contraste del modelo. Las pruebas de pago ahora se ejecutan en serie para evitar reservas simultáneas de saldo.

No se declara superada la validación live: OpenRouter terminó rechazando peticiones con HTTP 403 por límite total de la clave alcanzado. Hace falta habilitar presupuesto y completar tanto las pruebas sintéticas con proveedor como la regresión del expediente reportado antes de publicar. Los originales, auditorías y decisiones de producción no se sustituyeron durante las pruebas. Los resultados crudos y datos reales permanecen en rutas ignoradas.

### Revalidación con límite de clave habilitado

Se confirmó el aumento del límite de la clave a USD 10. Las pruebas live superaron la cancelación personal por salud con retención y la separación entre fecha administrativa e inicio académico. Persisten pruebas pendientes: el proveedor respondió HTTP 402 y la consulta de créditos confirmó saldo de cuenta insuficiente para reservar las llamadas restantes. No se confunde el límite de una clave con el saldo comprado de la cuenta; no se declara aprobado el conjunto live ni se publica el cambio.

Además se eliminó una comprobación frágil de palabras exactas en missingEvidence.reason. Los conteos de 5.2, sus estados, el bloqueo y la coherencia con el resultado siguen validados estructuralmente; la explicación y aplicabilidad se contrastan por IA contra V5. La regresión verifica explicaciones equivalentes y conserva el rechazo de una clasificación definitiva con conteos no determinables. El procedimiento oficial permanece sin cambios.

### Publicación autorizada con validaciones live pendientes

El usuario autorizó expresamente publicar sin recarga de OpenRouter. La entrega conserva la validación local completa y los resultados live ya obtenidos; las pruebas live restantes y la regresión final del expediente real permanecen pendientes. La autorización no convierte esas pruebas pendientes en aprobadas. El pipeline no publica propuestas cuando el contraste falla, y los originales e históricos se conservan.

Validación local final de esta entrega: lint, tipos, secretos, contraste y build correctos; 1.306 pruebas automáticas aprobadas (4 pruebas live excluidas de esa suite); 12 Functions. La ejecución live separada superó salud/retención e inicio de ciclo; no se declara aprobado el conjunto live ni la regresión final del expediente reportado. Publicación autorizada por el usuario con esas comprobaciones pendientes.
