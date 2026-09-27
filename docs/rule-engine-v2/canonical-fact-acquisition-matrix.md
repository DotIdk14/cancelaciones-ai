# Matriz de adquisición de hechos canónicos

Total de hechos canónicos: 94

## Conteo por categoría

| Categoría | Total |
|---|---:|
| AUDIT_METADATA | 4 |
| AUXILIARY_REFERENCE | 1 |
| DERIVED | 3 |
| DIRECT_EXTRACTION | 46 |
| OWNER_MAPPING_REQUIRED | 1 |
| TEMPORAL_DERIVATION | 39 |

## Detalle

| Fact ID | Categoría | Tipo | AI | Validación determinista | Reglas | Estrategia |
|---|---|---:|---:|---:|---|---|
| `F-acciones_activacion_gm` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-ILOC-ESPECIAL-RETENCION, R-ILOC-ESPECIAL-CV | Extraer de evidencia DATABASE, TEXT, PDF y validar contra tipo BOOLEAN. |
| `F-actividad_alianza` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-ILOC | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F-actividad_diplomado` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-ILOC | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F-actividad_en_alguna_asignatura` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC-N74 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-actividad_licenciatura` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC-N74, R-ILOC | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-actividad_posgrado` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-ILOC | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F-ajuste_por_error_inscripcion` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-V | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-calificaciones_bimestre_1` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-FILTRO-CALIFICACIONES | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-cambio_ciclo_antes_del_inicio` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-CICLO-A, R-CAUSAL-CICLO-B | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-cambio_ciclo_autorizado` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CICLO-NO-AUTORIZADO | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-cambio_ciclo_desiste_nuevamente` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CICLO-DESISTE | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-cambio_ciclo_gestionado_por` | AUDIT_METADATA | ENUM | no | sí | R-CAUSAL-CICLO-A, R-CAUSAL-CICLO-B | Leer del metadata de auditoría o prellenar desde evidencia si aparece en documentos. |
| `F-cambio_ciclo_nuevo_no_ingresa` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-CICLO-A, R-CAUSAL-CICLO-B | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-canal_venta` | DIRECT_EXTRACTION | ENUM | no | sí | R-FILTRO-MYSTERY | Extraer de evidencia DATABASE y validar contra tipo ENUM. |
| `F-canalizado_a_ee` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC-SOLIC | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-carta_manifiesto_firmada` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-DOC-A-BREAK | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-causa_operativa_documentada` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-ILOC-N91 | Extraer de evidencia TICKET, TEXT, PDF y validar contra tipo BOOLEAN. |
| `F-ce_decision_no_continuar` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-V | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-ciclo_revalidacion_equivalencia` | AUDIT_METADATA | BOOLEAN | no | sí | R-CICLO-NO-AUTORIZADO | Leer del metadata de auditoría o prellenar desde evidencia si aparece en documentos. |
| `F-con-actividad-nivel` | DERIVED | BOOLEAN | no | sí | — | No se extrae directamente: se deriva de hechos/contexto canónico ya aceptado. |
| `F-contacto_any_gestion` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-ILOC-N75 | Extraer de evidencia DATABASE, AUDIO, TEXT y validar contra tipo BOOLEAN. |
| `F-contacto_efectivo` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC, R-ILOC-ESPECIAL-RETENCION, R-ILOC-ESPECIAL-CV | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-contacto_unico_bot` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-BOT | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-creditos_no_avalan_100` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | — | Extraer de evidencia ACADEMIC_RECORD, PDF y validar contra tipo BOOLEAN. |
| `F-cv-motivo` | DIRECT_EXTRACTION | ENUM | sí | sí | R-CV-DEF | Extraer de evidencia STUDENT_STATEMENT, TEXT, WRITTEN_INTERACTION y validar contra tipo ENUM. |
| `F-decision_explicita_por_promesas` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-PROMESA | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-documento_grado_previo_ausente` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-DOC-A-BREAK | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-ee_cumplio_interacciones` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-ILOC-N91 | Extraer de evidencia DATABASE, TICKET y validar contra tipo BOOLEAN. |
| `F-estudiante_no_puede_entregar` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-DOC-A-BREAK | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-estudiante_rechaza_alternativa` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-QUORUM | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-estudiante_se_presenta_no_continuar` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC-SOLIC | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-evidencia_alternativa_reprogramacion` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-CAUSAL-QUORUM | Extraer de evidencia WRITTEN_INTERACTION, TEXT, DATABASE y validar contra tipo BOOLEAN. |
| `F-evidencia_bo_no_acredita_grado` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-DOC-B | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-evidencia_sistema_oficial` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-PROMESA-N52 | Extraer de evidencia SIU, DATABASE, PDF y validar contra tipo BOOLEAN. |
| `F-excede_plazos_promesa` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ESCALAMIENTO-N57, R-ESCALAMIENTO-N58 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-gm_conoce_solicitud_previo` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-PROMESA-N54 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-grupo_no_abierto` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-CAUSAL-QUORUM | Extraer de evidencia DATABASE, ACADEMIC_RECORD y validar contra tipo BOOLEAN. |
| `F-habil_1_20_dias` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-V, R-CAUSAL-EE | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-informacion_erronea_inscripcion` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-CAUSAL-PROMESA | Extraer de evidencia TEXT, WRITTEN_INTERACTION, STUDENT_STATEMENT y validar contra tipo BOOLEAN. |
| `F-ingreso_aula_regular` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ILOC-ESPECIAL-RETENCION, R-ILOC-ESPECIAL-CV | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-intencion_expresa_darse_de_baja` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-PROMESA-N53, R-OP-INTENCION-BAJA | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-latam_convalidacion_evidencia` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-PROMESA-N56 | Extraer de evidencia ACADEMIC_RECORD, PDF, DATABASE y validar contra tipo BOOLEAN. |
| `F-llamadas_rango_estudiante` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | — | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-marcaciones_colapsadas` | OWNER_MAPPING_REQUIRED | NUMBER | no | sí | — | No automatizar como verdad hasta que el Owner defina el umbral o equivalencia semántica. |
| `F-mejora_continua_no_emite` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-ESCALAMIENTO-N13 | Extraer de evidencia TICKET, TEXT, DATABASE y validar contra tipo BOOLEAN. |
| `F-nivel-academico` | DERIVED | ENUM | no | sí | R-ILOC | No se extrae directamente: se deriva de hechos/contexto canónico ya aceptado. |
| `F-nueva_iniciativa` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-ESCALAMIENTO-N14 | Extraer de evidencia TEXT, PDF y validar contra tipo BOOLEAN. |
| `F-op_actualizacion_producto_sin_comunicacion` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-H | Extraer de evidencia TICKET, TEXT, PDF y validar contra tipo BOOLEAN. |
| `F-op_canal_no_excluido` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-OP-A | Extraer de evidencia DATABASE y validar contra tipo BOOLEAN. |
| `F-op_discrepancia_paquete` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-F | Extraer de evidencia PDF, DATABASE, TEXT y validar contra tipo BOOLEAN. |
| `F-op_error_afectacion_experiencia` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-OP-B | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-op_error_es_proceso_no_asesor` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-F | Extraer de evidencia TICKET, TEXT y validar contra tipo BOOLEAN. |
| `F-op_error_finanzas` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-B | Extraer de evidencia TICKET, TEXT y validar contra tipo BOOLEAN. |
| `F-op_error_seguimiento_ee` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-E | Extraer de evidencia TICKET, TEXT, DATABASE y validar contra tipo BOOLEAN. |
| `F-op_error_servicios_escolares_d35` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-A | Extraer de evidencia TICKET, TEXT, DATABASE y validar contra tipo BOOLEAN. |
| `F-op_error_validacion_bo` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-OP-G | Extraer de evidencia TICKET, DATABASE, TEXT y validar contra tipo BOOLEAN. |
| `F-op_incidencia_sistema` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-FILTRO-INCIDENCIA, R-OP-C | Extraer de evidencia TICKET, DATABASE, TEXT y validar contra tipo BOOLEAN. |
| `F-op_no_canalizo_a_ee` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-OP-D | Extraer de evidencia DATABASE, TICKET y validar contra tipo BOOLEAN. |
| `F-otra_politica_lineamiento` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-ESCALAMIENTO-N89 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-quorum_no_alcanzado` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-QUORUM | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-rechazo_beneficios_adicionales` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-CAUSAL-PROMESA | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F-retencion_realizada` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-FILTRO-RETENCION | Extraer de evidencia DATABASE, AUDIO, TEXT, TICKET y validar contra tipo BOOLEAN. |
| `F-sin-actividad-nivel` | DERIVED | BOOLEAN | no | sí | R-ILOC | No se extrae directamente: se deriva de hechos/contexto canónico ya aceptado. |
| `F-tipo_ajuste` | DIRECT_EXTRACTION | ENUM | sí | sí | R-CAUSAL-V, R-CAUSAL-EE | Extraer de evidencia TEXT, DATABASE y validar contra tipo ENUM. |
| `F-validacion_registrada_speech_tc` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-PROMESA-N50 | Extraer de evidencia DATABASE, AUDIO, TEXT y validar contra tipo BOOLEAN. |
| `F-validacion_sin_incidencias` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-PROMESA-N53 | Extraer de evidencia DATABASE, TICKET y validar contra tipo BOOLEAN. |
| `F2-baja_falta_docs_6meses` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-D53-RELOJ-6M, R-D53-RELOJ-50 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-campus` | AUDIT_METADATA | ENUM | no | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Leer del metadata de auditoría o prellenar desde evidencia si aparece en documentos. |
| `F2-cc_acepta_tc` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Extraer de evidencia SIU, PDF, IMAGE y validar contra tipo BOOLEAN. |
| `F2-cc_cargada_siu_antes_inscripcion` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Extraer de evidencia SIU, PDF y validar contra tipo BOOLEAN. |
| `F2-cc_firmada_manuscrita_tinta_azul` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Extraer de evidencia PDF, IMAGE y validar contra tipo BOOLEAN. |
| `F2-cc_obligatoria_latam` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Extraer de evidencia PDF, IMAGE, SIU y validar contra tipo BOOLEAN. |
| `F2-cc_termino_meses` | TEMPORAL_DERIVATION | NUMBER | no | sí | R-D53-COMPROMISO-OK, R-D53-COMPROMISO-FALTA | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-ciclo` | AUDIT_METADATA | ENUM | no | no | — | Leer del metadata de auditoría o prellenar desde evidencia si aparece en documentos. |
| `F2-d53_aplica` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-D53-APLICA | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F2-d53_apocrifo_sospecha` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-APOCRIFO | Extraer de evidencia PDF, IMAGE, TICKET y validar contra tipo BOOLEAN. |
| `F2-d53_bimestre_cierre_superado` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-D53-REINGRESO | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-d53_cierre_aula_3a_semana_bimestre` | TEMPORAL_DERIVATION | DATE | no | sí | R-D53-EXPEDIENTE | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-d53_decision_mantiene` | AUXILIARY_REFERENCE | BOOLEAN | no | sí | R-D53-INVARIANTE | No pedir al usuario: es referencia/invariante normativo declarado por fuente auxiliar. |
| `F2-d53_excluido` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-D53-EXCLUIDO | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-d53_expediente_completo` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-D53-EXPEDIENTE | Extraer de evidencia PDF, IMAGE, SIU y validar contra tipo BOOLEAN. |
| `F2-d53_meses_desde_ingreso` | TEMPORAL_DERIVATION | NUMBER | no | sí | R-D53-RELOJ-6M, R-D53-RELOJ-50 | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-d53_reingreso_si_entrega_mismo_bimestre` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-D53-REINGRESO | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-d53_resp_backoffice` | DIRECT_EXTRACTION | BOOLEAN | no | sí | — | Extraer de evidencia DATABASE y validar contra tipo BOOLEAN. |
| `F2-d53_supera_50` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-D53-RELOJ-6M, R-D53-RELOJ-50 | Extraer de evidencia ACADEMIC_RECORD, SIU y validar contra tipo BOOLEAN. |
| `F2-decide_continuar` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-RET-03 | Extraer de evidencia STUDENT_STATEMENT, AUDIO, TEXT y validar contra tipo BOOLEAN. |
| `F2-decision_35` | DIRECT_EXTRACTION | ENUM | no | sí | R-D53-EXCLUIDO, R-D35-TARDE | Extraer de evidencia SIU, DATABASE y validar contra tipo ENUM. |
| `F2-decision_53_preadmitido` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-D53-APLICA | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F2-es_nuevo_ingreso` | TEMPORAL_DERIVATION | BOOLEAN | no | sí | R-D53-APLICA, R-CV-DEF-ALCANCE | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-estatus_alumno_regular` | DIRECT_EXTRACTION | BOOLEAN | no | sí | — | Extraer de evidencia SIU, DATABASE y validar contra tipo BOOLEAN. |
| `F2-manifiesto_baja` | DIRECT_EXTRACTION | BOOLEAN | sí | sí | R-RET-01 | Extraer de evidencia STUDENT_STATEMENT, AUDIO, TEXT, WRITTEN_INTERACTION y validar contra tipo BOOLEAN. |
| `F2-periodo` | TEMPORAL_DERIVATION | ENUM | no | no | — | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
| `F2-riesgo_de_baja` | DIRECT_EXTRACTION | BOOLEAN | no | sí | R-RET-01 | Extraer de evidencia DATABASE, TICKET y validar contra tipo BOOLEAN. |
| `F2-tipo_ingreso` | TEMPORAL_DERIVATION | ENUM | no | sí | R-D53-APLICA, R-D53-EXCLUIDO | Normalizar fechas/periodos desde metadata o evidencia, sin usar fecha actual del sistema. |
