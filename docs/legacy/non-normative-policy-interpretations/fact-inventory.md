# Inventario inicial de facts

| Fact | Reglas | Evidencia probable | Extraccion |
|---|---|---|---|
| `student.identity.name` | reporte, contacto efectivo | Dictamen, SIU, aula, ticket | OCR/vision/parser |
| `student.identity.enrollmentId` | reporte | Dictamen, SIU | OCR/parser |
| `student.email` | reporte, contacto | Dictamen, SIU, CRM | OCR/parser |
| `student.phone` | contacto | Dictamen, CRM/I6 | OCR/parser |
| `student.country` | cobertura, LATAM | canal, telefono, SIU | parser/LLM |
| `student.program` | reporte, nivel | Dictamen, SIU/aula | OCR/parser |
| `student.level` | 5.8.a | programa, aula/SIU | normalizacion/manual |
| `audit.caveId` | reporte | nombre de archivo, Dictamen | parser/OCR |
| `audit.ticketRequestDate` | 5.1, 5.14 | Dictamen/Flokzu | parser/OCR |
| `student.startDate` | 5.1, 5.2, 5.3, 5.8 | Dictamen, SIU | parser/OCR |
| `decision.decisionDate` | 5.3.a.III | Dictamen, SER | parser/OCR |
| `student.requestedNotContinue` | 5.3, 5.6, 5.9 | audios, chats, correos | AssemblyAI/vision/LLM structured |
| `student.requestedNotContinueDate` | 5.3 | chats, llamadas, ticket | timestamp/parser |
| `contact.callAttempts.count` | 5.2, 5.8 | I6/CRM screenshots/export | table parser/vision |
| `contact.callAttempts.byDayAndTime` | 5.2 | I6/CRM | table parser/vision |
| `contact.writtenInteractions.count` | 5.2 | WhatsApp/CRM/email | parser/vision |
| `contact.effectiveContact` | 5.8.g | audio transcript, chats | structured extraction + human review |
| `classroom.hasLogin` | 5.8 | aula screenshots | OCR/vision |
| `classroom.hasEvaluationMode` | 5.8.a | aula/SIU | OCR/vision |
| `classroom.hasActivities` | 5.8, historicos | aula | OCR/vision |
| `classroom.hasGrades` | 5.7.d | aula/SIU | OCR/vision |
| `retention.processAttempted` | 5.3.b | CRM/ticket | LLM structured |
| `retention.accepted` | 5.3, 5.6 | transcript/chat | LLM structured |
| `sales.falsePromiseEvidence` | 5.6 | audios/correos/WhatsApp | AssemblyAI/vision/LLM |
| `enrollment.error` | 5.5 | ticket/SIU | parser/LLM |
| `adjustment.requestDate` | 5.3.c | ticket/chat | parser/OCR |
| `adjustment.completed` | 5.3.c | SIU/ticket | parser/OCR |
| `sale.channel` | 5.10 | Dictamen/ticket | parser/OCR |
