// =============================================================================
// Dashboard — métricas de calidad y revisión humana
// =============================================================================
import { type AuditResultType, type CaseStatus } from '../skills/audit/types.js';
import { type ConfidenceBand } from '../lib/labels.js';
import type { DashboardFilters, MissingEvidenceBucket } from '../lib/dashboard.js';
import type { DashboardMetricRow } from './dashboard-contracts.js';
import { confidenceBand } from './dashboard-summary.js';
import { percentage, round3 } from './dashboard-utils.js';
import type { ComparisonStatusRow } from './reviews.js';



// =============================================================================
// Calidad
// =============================================================================
// Esta vista tiene DOS fuentes, y sólo una de las dos existe por construcción:
//
//  1. LA CONFIANZA que declaró el modelo en cada dictamen. Vive desde el primer
//     dictamen, y se lee de `public.audit_dashboard_metrics`.
//
//  2. LA REVISIÓN HUMANA: qué decidió una persona, y si el modelo coincidió con
//     esa decisión al comparar. Nació con el módulo de revisión humana
//     (`case_reviews` + `case_comparisons`) y se lee de
//     `public.case_comparisons_dashboard_metrics`.
//
// LA DIFERENCIA ENTRE UNA PANTALLA HONESTA Y UNA QUE MIENTE ESTÁ ENTERA EN LO QUE
// HACE ESTE ARCHIVO CUANDO NO HAY DATO. Un `agreementRate: 0` afirmaría "hubo
// cero coincidencias", y eso es FALSO cuando lo que pasa es que nadie comparó: no
// es que la IA falle siempre, es que todavía no hay nada que medir. Lo que se
// devuelve es `null` más un motivo legible, y la UI lo pinta como "sin dato",
// nunca como cero. Es el mismo criterio que ya separa NULL de 0 en las columnas
// de coste de la vista de métricas (`COST_PER_ROW`, con su tripleta fijada por
// un test más arriba en este archivo), y por eso aquí hay tests que lo fijan
// también.
//
// NADA DE ESTA SECCIÓN CLASIFICA (NO_RULES_ENGINE). El bloque humano no
// reinterpreta el veredicto de la comparación: `agrees` y `confidence` los
// escribió el modelo y ya pasaron por `ComparisonResultSchema`
// (src/skills/review/schema.ts). Aquí sólo se cuentan y se promedian. La
// resolución final del caso sigue siendo la de la persona, y el modelo dice si
// discrepa, no reemplaza la decisión.
// =============================================================================

/**
 * Etiqueta CORTA de cada banda, para el eje X de la gráfica (donde "Alta
 * confianza" no cabe y "Media confianza" se solaparía con la vecina).
 *
 * NO sustituye a `CONFIDENCE_BAND_LABELS` (`src/lib/labels.ts`), que sigue siendo
 * la forma larga y canónica: el `band` viaja siempre junto a `label`, así que
 * cualquiera que necesite el nombre completo lo tiene sin volver a pedirlo.
 */
const CONFIDENCE_BAND_SHORT_LABELS: Record<ConfidenceBand, string> = {
  ALTA: 'Alta',
  MEDIA: 'Media',
  BAJA: 'Baja',
};

/** Orden fijo de las bandas: siempre las 3, aunque valgan 0. */
const CONFIDENCE_BAND_ORDER: readonly ConfidenceBand[] = ['ALTA', 'MEDIA', 'BAJA'];

/**
 * Fila de `public.case_comparisons_dashboard_metrics`.
 *
 * ESCALARES SOLO, igual que `DashboardMetricRow`: la vista no expone
 * `result_json` ni el comentario humano, y no los expone por una razón concreta.
 * `explanation` y `discrepancyReason` son texto que el modelo escribió sobre un
 * expediente con PII, y nadie los necesita para contar; lo que hace falta son
 * `agrees` y `confidence`, que son dos números.
 *
 * `agrees` y `confidence` son `null` cuando la fila está `RUNNING` o `ERROR` (es
 * así como las escribe `reviews.ts`) y también cuando el `result_json` no trae
 * un valor legible. `null` significa "no hay dato", y por eso el agregador nunca
 * lo cuenta como desacuerdo.
 */
export interface ComparisonMetricRow {
  id: string;
  case_review_id: string;
  case_id: string;
  /** Estado del CASO, para que el filtro `status` del dashboard aplique también aquí. */
  case_status: CaseStatus | null;
  /** Dictamen de la auditoría COMPARADA, para que el filtro `result` aplique. */
  audit_result: AuditResultType | null;
  status: ComparisonStatusRow;
  /** Fecha de la comparación: es la que recorta el periodo de este bloque. */
  created_at: string;
  agrees: boolean | null;
  confidence: number | null;
  /** Resolución humana final, obtenida de case_reviews por case_review_id. */
  human_result?: string | null;
}

/**
 * Entrada humana del agregador: lo que la consulta deja para el periodo.
 *
 * Se pasa SEPARADA de las filas de `DashboardMetricRow` a propósito. Son dos
 * fuentes distintas, con dos periodos distintos (`audits.created_at` y
 * `case_comparisons.created_at`) y dos filas distintas, y mezclarlas haría que
 * un filtro del dashboard moviera la coincidencia por un efecto secundario. Por
 * eso `aggregateQuality` la recibe como argumento OBLIGATORIO: un valor por
 * defecto haría que olvidar cablearla en producción se viera como un informe
 * honesto de "no hay revisiones", que es justo la mentira que este bloque evita.
 */
export interface HumanReviewInput {
  /**
   * Revisiones humanas del periodo. Incluye las registradas en el rango MÁS las
   * que son dueñas de una comparación del rango (una revisión del 31 de agosto
   * cuya comparación terminó el 2 de septiembre cuenta: es la misma historia
   * humana, y sin ella el bloque se contradiría a sí mismo, diciendo "no hay
   * revisión registrada" junto a una tasa ya calculada).
   */
  reviewedCases: number;
  /** Comparaciones del periodo, ya recortadas por la consulta. */
  comparisons: ComparisonMetricRow[];
  /** Total exacto del periodo, para poder avisar de una truncación. */
  comparisonsAvailable: number;
}

export interface HumanDiscrepancy {
  caseId: string;
  aiResolution: string;
  humanResolution: string;
  createdAt: string;
}

/**
 * Parte humana del informe de calidad.
 *
 * LO QUE ESTA INTERFAZ PROMETE, POR TIPO: `agreementRate` y
 * `avgComparisonConfidence` son `number | null`, y el `null` significa "no se ha
 * medido". Por eso NO son `number` con un 0 de reserva: un `0` es un dato
 * AFIRMADO ("de todas las comparaciones, ninguna coincidió"), y en el caso que
 * importa es FALSO, porque lo que pasa es que todavía no se comparó nada. El 0
 * se reserva para los contadores, que son hechos y no promedios: `0` revisiones
 * registradas SÍ es verdad cuando nadie ha revisado nada.
 *
 * `agreementRate` es una RAZÓN entre 0 y 1, NO un porcentaje: 0.667 son dos
 * tercios. Se redondea a 3 decimales, igual que las medias de confianza del
 * informe, para que la coma flotante no deje `0.6666666666666666` en la
 * pantalla.
 */
export interface HumanReviewReport {
  /** `true` si existe al menos UNA revisión humana en el periodo. */
  available: boolean;
  /**
   * Explicación del estado actual, en español, lista para pintar tal cual.
   *
   * La redacta el SERVIDOR y no el frontend a propósito: la explicación de por
   * qué falta un dato tiene que vivir junto al cálculo que la produce, y todos
   * los números que aparecen en el texto salen de las cifras de este mismo
   * objeto. Si el mensaje lo compusiera la UI, podría decir "no hay datos" con
   * datos delante sin que nadie lo notara.
   */
  message: string;
  /** Revisiones humanas registradas que el periodo contiene. */
  reviewedCases: number;
  /**
   * Revisiones con resultado humano y de auditoría disponibles: en el flujo de
   * comparaciones son las `COMPLETED`, las únicas con veredicto y el
   * denominador de `agreementRate`.
   */
  comparableReviews: number;
  /** Comparaciones `COMPLETED`: las únicas con veredicto. */
  completedComparisons: number;
  /** Comparaciones `RUNNING`: en curso, sin veredicto todavía. */
  pendingComparisons: number;
  /** Comparaciones `ERROR`: terminadas en fallo, sin veredicto. */
  failedComparisons: number;
  /** De las completadas, cuántas afirmaron coincidencia (`agrees === true`). */
  agreements: number;
  /** De las completadas, cuántas afirmaron discrepancia (`agrees === false`). */
  disagreements: number;
  /** `agreements / completedComparisons`, o `null` si no hay comparaciones completadas. */
  agreementRate: number | null;
  /** Media de `confidence` de las COMPLETED que lo declararon, o `null` si ninguna. */
  avgComparisonConfidence: number | null;
  /** Discrepancias recientes con resoluciones cerradas; sin comentario ni texto del modelo. */
  discrepancies: HumanDiscrepancy[];
  discrepanciesTruncated: boolean;
}

/**
 * Contadores de las comparaciones del periodo, ya reducez por estado.
 *
 * Se calculan UNA vez y alimentan tanto el informe como el `message`, para que el
 * texto no pueda contradecir a los números que acompaña: si los dos salieran de
 * recorridos distintos, un `message` podría acabar diciendo "2 comparaciones
 * completadas" junto a un `completedComparisons: 3`.
 */
interface HumanReviewCounts {
  completed: number;
  pending: number;
  failed: number;
  agreements: number;
  disagreements: number;
  /** Comparaciones COMPLETED que declararon confianza (denominador de la media). */
  confidenceReported: number;
  confidenceSum: number;
}

/**
 * Recorre las comparaciones del periodo y las reparte por estado.
 *
 * POR QUÉ `RUNNING` Y `ERROR` NO SON NI UN ACUERDO NI UN DESACUERDO: una
 * comparación en curso todavía no tiene veredicto, y una fallida no llegó a
 * emitirlo. Contarlas como desacuerdo publicaría una discrepancia que nadie
 * registró, que es justo el defecto que este bloque evita. Se informan aparte,
 * en `pendingComparisons` y `failedComparisons`.
 *
 * `agrees === null` en una fila `COMPLETED` es una forma defensiva: la fila
 * AFIRMA que terminó (eso dice su `status`, y es un dato), pero no trae
 * veredicto legible. Suma a `completed` —porque terminó— y ni a `agreements` ni a
 * `disagreements`, porque no hay nada que repartir entre esos dos. Nunca ocurre
 * con datos reales: `updateComparisonResult` sólo escribe un `result_json` que ya
 * pasó `ComparisonResultSchema` (src/skills/review/schema.ts).
 */
function countComparisons(comparisons: ComparisonMetricRow[]): HumanReviewCounts {
  const counts: HumanReviewCounts = {
    completed: 0,
    pending: 0,
    failed: 0,
    agreements: 0,
    disagreements: 0,
    confidenceReported: 0,
    confidenceSum: 0,
  };

  for (const row of comparisons) {
    if (row.status === 'RUNNING') {
      counts.pending += 1;
      continue;
    }
    if (row.status === 'ERROR') {
      counts.failed += 1;
      continue;
    }

    counts.completed += 1;
    if (row.agrees === true) counts.agreements += 1;
    else if (row.agrees === false) counts.disagreements += 1;

    // Ausente o no finito: dato ausente. Promediarlo bajaría la confianza media
    // de la comparación con un valor que nadie declaró.
    const confidence = row.confidence;
    if (confidence !== null && Number.isFinite(confidence)) {
      counts.confidenceSum += confidence;
      counts.confidenceReported += 1;
    }
  }

  return counts;
}

/** `1 revisión humana` / `2 revisiones humanas`. El número SIEMPRE delante. */
function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}

/** Enumera sin Oxford coma: `a, b y c`. Nunca recibe una lista vacía. */
function enumerar(partes: readonly string[]): string {
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1] ?? ''}`;
}

/**
 * Estado sin una sola revisión humana. El texto va FIJO y un test lo fija
 * entero: es el mensaje que la UI explica bajo las tarjetas vacías, y si cambia
 * tiene que cambiar a propósito.
 */
const SIN_REVISION_MESSAGE =
  'Todavía no hay ninguna revisión humana registrada en el periodo, así que no hay nada que comparar: ' +
  'la coincidencia entre el dictamen de la IA y la decisión de una persona no se puede calcular. ' +
  'Se muestra únicamente lo que sí existe: la confianza declarada por el modelo en cada dictamen.';

/**
 * Frase de apertura, común a todos los estados con revisiones: el número de
 * revisiones del periodo sale de `input.reviewedCases`, ya contado por la
 * consulta, así que el texto nunca puede afirmar más de lo que el dato sostiene.
 */
function cabeceraRevisiones(reviewedCases: number): string {
  return `Hay ${pluralizar(reviewedCases, 'revisión humana registrada', 'revisiones humanas registradas')} en el periodo`;
}

/**
 * POR QUÉ EL SERVIDOR REDACTA EL `message` Y NO LA UI
 *
 * La explicación de por qué falta un dato tiene que vivir JUNTO al cálculo que la
 * produce, o las dos piezas se desincronizan sin que nada falle. Con el mensaje
 * aquí, todos los números que aparecen en el texto salen de `counts` —el mismo
 * objeto que alimenta las cifras de la tarjeta— y la UI lo pinta tal cual
 * (`src/components/dashboard/QualityPage.tsx`).
 *
 * Y hay un criterio más fuerte que el de no contradecirse: el texto no puede
 * AFIRMAR un estado que los datos no sostienen. Por eso "en curso" y "falló" son
 * cláusulas condicionales y no un menú fijo: cuando no hay nada en curso, el
 * mensaje no dice "en curso", porque eso insinuaría una actividad que no existe.
 *
 * LA REGLA DE LOS ESTADOS, en orden:
 *   1. Sin revisiones                  -> el mensaje fijo de arriba.
 *   2. Revisiones y NINGUNA comparación -> "ninguna tiene comparación": no hay
 *      nada en curso porque no se empezó nada. Es un tercer estado, distinto
 *      tanto de "en curso" como de "falló".
 *   3. Sin completadas, sólo en curso   -> la tasa todavía no se puede calcular.
 *   4. Sin completadas, sólo fallidas   -> se dice que FALLARON, nunca "en curso".
 *   5. Sin completadas, de las dos      -> las dos, con la misma reserva.
 *   6. Con completadas, nada pendiente  -> se mide sobre ellas y ya.
 *   7. Con completadas y resto          -> se mide SÓLO sobre las completadas, y se
 *      dice explícitamente que las demás no cuentan.
 */
function humanReviewMessage(input: HumanReviewInput, counts: HumanReviewCounts, available: boolean): string {
  if (!available) return SIN_REVISION_MESSAGE;

  const cabecera = cabeceraRevisiones(input.reviewedCases);
  const { completed, pending, failed } = counts;

  // Estado 2: hay revisiones pero ni una comparación. No hay nada en curso
  // porque no se empezó nada, y decirlo con "en curso" sería mentir.
  if (input.comparisons.length === 0) {
    return (
      `${cabecera} y ninguna tiene comparación: la coincidencia entre el dictamen de la IA ` +
      `y la decisión de una persona todavía no se puede calcular porque no se ha comparado ` +
      `ningún caso del periodo.`
    );
  }

  const sinCompletadas =
    `${cabecera}, con ${pluralizar(pending, 'comparación en curso', 'comparaciones en curso')} ` +
    `y ${pluralizar(failed, 'comparación fallida', 'comparaciones fallidas')}, ninguna completada todavía: ` +
    `la coincidencia entre el dictamen de la IA y la decisión de una persona no se puede calcular. ` +
    `Las comparaciones que no se completaron no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`;

  // Estado 3: sólo en curso.
  if (completed === 0 && pending > 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(pending, 'comparación en curso', 'comparaciones en curso')} ` +
      `y ninguna completada todavía: la coincidencia entre el dictamen de la IA y la decisión de ` +
      `una persona no se puede calcular hasta que exista una comparación completada.`
    );
  }

  // Estado 4: sólo fallidas. El verbo va en plural porque el texto tiene que
  // poder hablar del conjunto aunque haya una sola.
  if (completed === 0 && failed > 0 && pending === 0) {
    return (
      `${cabecera}, con ${pluralizar(failed, 'comparación fallida', 'comparaciones fallidas')}: ` +
      `ninguna llegó a emitir veredicto, así que la coincidencia entre el dictamen de la IA y la ` +
      `decisión de una persona no se puede calcular. Las comparaciones que fallaron no aportan ni ` +
      `acuerdo ni desacuerdo, y se informan aparte.`
    );
  }

  // Estado 5: en curso y fallidas, sin ninguna completada.
  if (completed === 0) return sinCompletadas;

  // Estado 6: hay completadas y nada más. La palabra "fallida" no aparece por
  // ningún lado: no hay ninguna, y nombrarla insinuaría un fallo inexistente.
  if (pending === 0 && failed === 0) {
    return (
      `${cabecera}, con ${pluralizar(completed, 'comparación completada', 'comparaciones completadas')}: ` +
      `la coincidencia entre el dictamen de la IA y la decisión de una persona se mide solo sobre ` +
      `ellas, porque todas las comparaciones del periodo terminaron.`
    );
  }

  // Estado 7: hay completadas y además alguna en curso o fallida. Se enumeran
  // SÓLO las que existen: nombrar una categoría vacía ("y 0 fallidas") insinuaría
  // un fallo que no ocurrió, que es la misma mentira en su forma más pequeña.
  const partes = [pluralizar(completed, 'comparación completada', 'comparaciones completadas')];
  if (pending > 0) partes.push(pluralizar(pending, 'comparación en curso', 'comparaciones en curso'));
  if (failed > 0) partes.push(`${failed} ${failed === 1 ? 'fallida' : 'fallidas'}`);

  return (
    `${cabecera}: ${enumerar(partes)}. La coincidencia entre el dictamen de la IA y la decisión de ` +
    `una persona se mide solo sobre las comparaciones completadas: las que no llegaron a completarse ` +
    `no cuentan ni como acuerdo ni como desacuerdo, y se informan aparte.`
  );
}

/**
 * Agrega la entrada humana del periodo en el bloque `humanReview` del informe.
 *
 * PURA: sin red, sin reloj y sin efectos secundarios. Recibe la entrada YA
 * recortada por periodo y filtros (`getHumanReviewInput`) y aquí sólo cuenta y
 * promedia.
 *
 * LA REGLA NÚMERO UNO, y la razón de que este bloque exista:
 *   `agreementRate` es `number | null` y vale `null` CUANDO `completedComparisons`
 *   es 0. Nunca 0.
 *
 * Un 0 ahí afirmaría "de todas las comparaciones, ninguna coincidió", y eso es
 * FALSO cuando lo que ocurre es que todavía no se comparó nada: no es que el
 * modelo falle siempre, es que no hay nada que medir. Por eso el 0 se queda
 * reservado para los CONTADORES, que son hechos (`0` revisiones registradas SÍ es
 * verdad cuando nadie ha revisado nada) y para el caso en que sí hubo
 * comparaciones completadas y ninguna coincidió, que es una afirmación
 * verdadera sobre un dato que existe.
 *
 * NADA DE ESTA FUNCIÓN CLASIFICA (NO_RULES_ENGINE). `agrees` y `confidence` los
 * escribió el modelo y ya pasaron por `ComparisonResultSchema`
 * (src/skills/review/schema.ts). Aquí sólo se cuentan y se promedian; la
 * resolución final del caso sigue siendo la de la persona.
 */
export function aggregateHumanReview(input: HumanReviewInput): HumanReviewReport {
  const counts = countComparisons(input.comparisons);
  // `available` responde "¿sabe el sistema algo de revisión humana?", así que
  // basta con que exista una revisión O una comparación: el agregado es puro y
  // no puede asumir que la consulta ya hizo esta unión.
  const available = input.reviewedCases > 0 || input.comparisons.length > 0;

  const agreementRate =
    counts.completed === 0 ? null : round3(counts.agreements / counts.completed);
  const avgComparisonConfidence =
    counts.confidenceReported === 0 ? null : round3(counts.confidenceSum / counts.confidenceReported);
  const discrepancyRows = input.comparisons.filter((row) => row.status === 'COMPLETED' && row.agrees === false
    && row.audit_result !== null && row.human_result != null);

  return {
    available,
    message: humanReviewMessage(input, counts, available),
    reviewedCases: input.reviewedCases,
    comparableReviews: counts.completed,
    completedComparisons: counts.completed,
    pendingComparisons: counts.pending,
    failedComparisons: counts.failed,
    agreements: counts.agreements,
    disagreements: counts.disagreements,
    agreementRate,
    avgComparisonConfidence,
    discrepancies: discrepancyRows
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map((row) => ({
        caseId: row.case_id,
        aiResolution: row.audit_result as string,
        humanResolution: row.human_result as string,
        createdAt: row.created_at,
      })),
    discrepanciesTruncated: discrepancyRows.length > 100,
  };
}

/** Bucket de evidencia faltante. La clave viaja como texto porque `2+` no es un número. */
export type { MissingEvidenceBucket };

/** Orden fijo de los buckets, de menos a más evidencia faltante. */
const MISSING_EVIDENCE_BUCKET_ORDER: readonly MissingEvidenceBucket[] = ['0', '1', '2+'];

/**
 * Etiquetas de cada bucket.
 *
 * El `2+` NO se desglosa en `2`, `3`, `4`… a propósito: la pregunta que responde
 * esta vista es "¿la confianza baja cuando el expediente está incompleto?", y para
 * eso interesa el efecto de una ausencia grande, no la cola de expedientes con
 * seis evidencias ausentes. Además, un bucket por cada valor real haría que la
 * gráfica mostrara un subconjunto arbitrario del periodo en lugar del periodo.
 */
const MISSING_EVIDENCE_BUCKET_LABELS: Record<MissingEvidenceBucket, string> = {
  '0': 'Expediente completo',
  '1': 'Falta 1 evidencia',
  '2+': 'Faltan 2 o más',
};

/**
 * Bucket de evidencia faltante de una fila.
 *
 * `missing_evidence_count` ausente se trata como 0, igual que hace
 * `recentCases`: es el valor por defecto que emite la vista y evita que una fila
 * sin dato desaparezca del reparto (y con ella, del numerador y del denominador
 * de la media).
 */
function missingEvidenceBucket(count: number | null): MissingEvidenceBucket {
  const missing = count ?? 0;
  if (missing >= 2) return '2+';
  if (missing === 1) return '1';
  return '0';
}

/**
 * Confianza declarada por el modelo, agrupada.
 *
 * `bands` trae SIEMPRE las 3 bandas, aunque valgan 0: una banda en cero es
 * información ("nunca hubo confianza baja"), y sin ella la gráfica cambiaría de
 * forma al mover el periodo en vez de al dato.
 *
 * `confidenceByMissingEvidence` es al revés a propósito: solo incluye los buckets
 * con al menos una fila. Poner un bucket en cero ahí sería afirmar "con un
 * expediente completo la confianza media es 0 %", que es falso: es que no hay
 * ningún expediente completo en el periodo.
 */
export interface ConfidenceReport {
  /** Dictámenes COMPLETED que declararon confianza (el denominador de `pct`). */
  auditedCases: number;
  /** `null` si ningún dictamen declaró confianza: la media de una lista vacía no es 0. */
  avgConfidence: number | null;
  bands: Array<{ band: ConfidenceBand; label: string; count: number; pct: number }>;
  confidenceByMissingEvidence: Array<{
    bucket: MissingEvidenceBucket;
    label: string;
    count: number;
    avgConfidence: number | null;
  }>;
}


/** Informe completo de `/api/dashboard/quality`. */
export interface QualityReport {
  generatedAt: string;
  truncated: boolean;
  filters: DashboardFilters;
  humanReview: HumanReviewReport;
  confidence: ConfidenceReport;
}

/**
 * Agrega las filas de la vista en el informe de Calidad.
 * Pura: sin red, sin reloj (salvo `generatedAt`) y sin efectos secundarios.
 *
 * `totalAvailable` es el total de filas que la base dice que hay (count exacto),
 * no el tamaño de `rows`: es lo único que permite avisar de una truncación.
 *
 * `humanReview` es OBLIGATORIO a propósito (ver `HumanReviewInput`): viene de
 * OTRA fuente y OTRO periodo, y darle un valor por defecto haría que olvidarla
 * al cablearla en producción se viera como un informe honesto de "no hay
 * revisiones", que es justo la mentira que este bloque evita. El compilador
 * obliga a pasar algo, y ese algo no puede ser inventado.
 */
export function aggregateQuality(
  rows: DashboardMetricRow[],
  filters: DashboardFilters,
  _totalAvailable: number,
  humanReview: HumanReviewInput,
): QualityReport {
  let confidenceSum = 0;
  let auditedCases = 0;
  const bandCounts: Record<ConfidenceBand, number> = { ALTA: 0, MEDIA: 0, BAJA: 0 };
  // Suma de confianza y nº de filas por bucket de evidencia faltante.
  const byMissing = new Map<MissingEvidenceBucket, { count: number; sum: number }>();

  for (const row of rows) {
    // SOLO `COMPLETED`. Una auditoría en `ERROR` no emitió dictamen, y una en
    // `RUNNING` todavía no: en los dos casos `confidence` no describe una
    // calidad de auditoría sino el estado del run, y meterla en la media bajaría
    // la confianza media con datos que no son de confianza.
    if (row.audit_status !== 'COMPLETED') continue;

    const confidence = row.confidence;
    // Ausente o no finito: dato ausente. No se cuela en la media ni cuenta como
    // banda baja (la ausencia de confianza NO es baja confianza).
    if (confidence === null || !Number.isFinite(confidence)) continue;

    auditedCases += 1;
    confidenceSum += confidence;

    const band = confidenceBand(confidence);
    // `confidenceBand` solo devuelve `null` con un valor no finito, que ya se
    // filtró arriba; la comprobación está para no inventar una banda si algún día
    // esa función cambiara.
    if (band !== null) bandCounts[band] += 1;

    const bucket = missingEvidenceBucket(row.missing_evidence_count);
    const agg = byMissing.get(bucket);
    if (agg === undefined) byMissing.set(bucket, { count: 1, sum: confidence });
    else {
      agg.count += 1;
      agg.sum += confidence;
    }
  }

  const bands: ConfidenceReport['bands'] = CONFIDENCE_BAND_ORDER.map((band) => ({
    band,
    label: CONFIDENCE_BAND_SHORT_LABELS[band],
    count: bandCounts[band],
    // `percentage` ya devuelve 0 cuando el denominador es 0, así que un
    // periodo sin dictámenes sale 0/0/0 y no `NaN`.
    pct: percentage(bandCounts[band], auditedCases),
  }));

  // Solo los buckets CON filas. Un bucket ausente no es un 0: es que no hubo
  // ningún caso así en el periodo, y por eso no aparece.
  const confidenceByMissingEvidence = MISSING_EVIDENCE_BUCKET_ORDER.flatMap((bucket) => {
    const agg = byMissing.get(bucket);
    if (agg === undefined) return [];
    return [
      {
        bucket,
        label: MISSING_EVIDENCE_BUCKET_LABELS[bucket],
        count: agg.count,
        avgConfidence: agg.count === 0 ? null : round3(agg.sum / agg.count),
      },
    ];
  });

  return {
    generatedAt: new Date().toISOString(),
    // CADA FUENTE AVISA DE SU PROPIO RECORTE. La parte humana tiene su propio
    // tope: si se recortó ÉSTA y no las auditorías, la tarjeta tiene que decirlo,
    // porque su tasa se calculó sobre menos comparaciones de las que existen.
    truncated: false,
    filters,
    humanReview: aggregateHumanReview(humanReview),
    confidence: {
      auditedCases,
      avgConfidence: auditedCases === 0 ? null : round3(confidenceSum / auditedCases),
      bands,
      confidenceByMissingEvidence,
    },
  };
}
