// Mapa de celdas de la pagina 1 de templates/Dictamen.pdf.
// Coordenadas en unidades PDF nativas (96 = 1pt), origen abajo-izquierda (A4 596x842),
// verificadas contra apps/web/src/server/reporting/template-layout.json
// y contra los clip rects del content stream (scripts/dump-p1-cells.mjs, NON_PRODUCTION).
//
// DECISION DE RENDERIZADO (OWNER_TEMPLATE_RENDERING_DECISION-002):
//  - Cada valor se dibuja a la derecha de su etiqueta dentro de la fila de la tabla,
//    borrando previamente el texto de ejemplo con el color de fondo de la celda.
//  - La validacion visual fina queda para MVP_ACCEPTANCE (la plantilla tiene filas
//    ambiguas entre "Comentarios BO/HelpDesk" y el bloque verde del dictamen).
export interface DictamenCell {
  /** X inicial (izquierda) del area de texto. */
  x: number;
  /** Y del baseline de la primera linea, desde abajo. */
  yBaseline: number;
  /** Limite derecho de wrap. */
  right: number;
  /** Tamano de fuente en pt. */
  size: number;
  /** Max lineas antes de continuar en pagina de anexo (0 = solo 1 linea). */
  maxLines: number;
  /** Color de fondo de la celda usado para borrar el valor de ejemplo. */
  bg: 'white' | 'blueLight' | 'yellow' | 'green';
  /** Zona de borrado del valor de ejemplo (x, yBottom, w, h). */
  erase: { x: number; y: number; w: number; h: number };
}

export type DictamenCellId =
  | 'nombre'
  | 'matricula'
  | 'correo'
  | 'canal'
  | 'programa'
  | 'fechaCreacion'
  | 'fechaDecision'
  | 'fechaInicioCiclo'
  | 'fechaSolicitudTicket'
  | 'asignado'
  | 'ultimaSesion'
  | 'telefono'
  | 'primerPago'
  | 'politica'
  | 'motivo'
  | 'descripcion'
  | 'comentariosBO'
  | 'comentariosHelpDesk'
  | 'comentariosSER'
  | 'comentariosFinanzas'
  | 'dictamenAplicadoEl'
  | 'dictamen';

export const PAGE1_CELLS: Record<DictamenCellId, DictamenCell> = {
  nombre: { x: 78, yBaseline: 753, right: 190, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 76, y: 742.6, w: 115, h: 23.1 } },
  matricula: { x: 248, yBaseline: 753, right: 340, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 246, y: 742.6, w: 93, h: 23.1 } },
  correo: { x: 385, yBaseline: 753, right: 520, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 383, y: 742.6, w: 137, h: 23.1 } },
  canal: { x: 66, yBaseline: 704.5, right: 190, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 64, y: 694, w: 126, h: 23.1 } },
  programa: { x: 251, yBaseline: 704.5, right: 340, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 249, y: 694, w: 91, h: 23.1 } },
  fechaCreacion: { x: 445, yBaseline: 704.5, right: 520, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 443, y: 694, w: 77, h: 23.1 } },
  fechaDecision: { x: 117, yBaseline: 656.2, right: 190, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 115, y: 646.2, w: 75, h: 23.1 } },
  fechaInicioCiclo: { x: 323, yBaseline: 656.2, right: 340, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 321, y: 646.2, w: 19, h: 23.1 } },
  fechaSolicitudTicket: { x: 477, yBaseline: 656.2, right: 520, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 475, y: 646.2, w: 45, h: 23.1 } },
  asignado: { x: 155, yBaseline: 608.4, right: 190, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 153.6, y: 598.4, w: 37, h: 23.1 } },
  ultimaSesion: { x: 271, yBaseline: 608.4, right: 340, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 269.5, y: 598.4, w: 71, h: 23.1 } },
  telefono: { x: 394, yBaseline: 608.4, right: 520, size: 11, maxLines: 1, bg: 'blueLight', erase: { x: 392, y: 598.4, w: 128, h: 23.1 } },
  primerPago: { x: 100, yBaseline: 560.6, right: 520, size: 11, maxLines: 1, bg: 'yellow', erase: { x: 98, y: 543.1, w: 422, h: 24 } },
  politica: { x: 186, yBaseline: 534.4, right: 520, size: 11, maxLines: 1, bg: 'yellow', erase: { x: 184, y: 517.2, w: 336, h: 24 } },
  motivo: { x: 72, yBaseline: 510.5, right: 520, size: 11, maxLines: 1, bg: 'yellow', erase: { x: 69.9, y: 491.4, w: 450, h: 24 } },
  descripcion: { x: 100, yBaseline: 486.6, right: 520, size: 11, maxLines: 1, bg: 'yellow', erase: { x: 97.4, y: 460.4, w: 423, h: 24 } },
  comentariosBO: { x: 123, yBaseline: 453, right: 520, size: 11, maxLines: 3, bg: 'yellow', erase: { x: 121, y: 417.1, w: 399, h: 48.8 } },
  comentariosHelpDesk: { x: 157, yBaseline: 431, right: 520, size: 11, maxLines: 1, bg: 'yellow', erase: { x: 154.8, y: 417.1, w: 365, h: 20 } },
  comentariosSER: { x: 128, yBaseline: 326, right: 520, size: 11, maxLines: 2, bg: 'yellow', erase: { x: 127, y: 304.1, w: 391, h: 32 } },
  comentariosFinanzas: { x: 152, yBaseline: 291, right: 520, size: 11, maxLines: 2, bg: 'green', erase: { x: 151.8, y: 268.7, w: 366, h: 32 } },
  dictamenAplicadoEl: { x: 148.5, yBaseline: 256, right: 520, size: 11, maxLines: 1, bg: 'green', erase: { x: 147.5, y: 239.7, w: 372, h: 24 } },
  dictamen: { x: 29.25, yBaseline: 129, right: 566, size: 11, maxLines: 6, bg: 'white', erase: { x: 29.25, y: 87, w: 537, h: 60 } },
};

export const CELL_BG_COLORS: Record<DictamenCell['bg'], { r: number; g: number; b: number }> = {
  white: { r: 1, g: 1, b: 1 },
  blueLight: { r: 0.7882, g: 0.8549, b: 0.9725 },
  yellow: { r: 1, g: 0.949, b: 0.8 },
  green: { r: 0.5608, g: 0.9412, b: 0.4235 },
};

export const INK_COLOR = { r: 0.0667, g: 0.0941, b: 0.1529 };
export const DRAFT_BANNER_COLOR = { r: 0.78, g: 0.22, b: 0.16 };
export const SECTION_HEADER_COLOR = { r: 0.2, g: 0.36, b: 0.4 };
export const PAGE_W = 596;
export const PAGE_H = 842;

export const DRAFT_WATERMARK_TEXT = 'BORRADOR — NO ES DOCUMENTO FINAL';
export const DICTAMEN_FOOTER_NOTE =
  'Documento generado por Cancelaciones AI. Verificar integridad con el resumen hash de la auditoria.';