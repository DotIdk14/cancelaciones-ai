Can't initialize prompt toolkit: No Windows console found. Are you running 
cmd.exe?
───────────────────────────────────────────────────────────────────────────────
Using openrouter/anthropic/claude-sonnet-4 model with API key from environment.
Aider v0.86.2
Main model: openrouter/anthropic/claude-sonnet-4 with diff edit format, 
infinite output
Weak model: openrouter/anthropic/claude-3-5-haiku
Git repo: .git with 271 files
Repo-map: using 4096 tokens, auto refresh
Here are summaries of some files present in my git repository.
Do not propose changes to these files, treat them as *read-only*.
If you need to edit any of these files, ask me to *add them to the chat* first.

scripts\contrast.mjs:
⋮
│function relativeLuminance(hex) {
│  const [r, g, b] = toRgb(hex).map((channel) => {
│    const c = channel / 255;
│    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
│  });
│  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
⋮

scripts\generate-policy.mjs:
⋮
│function tsString(value) {
│  return JSON.stringify(value)
│    .replace(/\u2028/g, '\\u2028')
│    .replace(/\u2029/g, '\\u2029');
⋮
│function fullText(sections) {
│  const parts = [
│    `PROCEDIMIENTO ${manifest.code} — ${manifest.title} — VERSIÓN 
${manifest.version}`,
│    `Fuente oficial: ${manifest.sourceFile} (SHA-256: 
${manifest.sourceSha256})`,
│    '',
│  ];
│  for (const section of sections) {
│    parts.push(`## Sección ${section.id} — ${section.title} (páginas 
${section.pages.join(', ') || 
│    parts.push(section.content);
│    parts.push('');
⋮

src\components\AppHeader.tsx:
⋮
│interface AppHeaderProps {
│  onSignOut?: () => void;
│  previewOnly?: boolean;
│  role?: AppRole | null;
│  canCreate?: boolean;
⋮

src\components\CaseListPage.tsx:
⋮
│export function CaseListPage(): ReactNode {
│  return (
│    <div className="flex flex-col gap-5">
│      <CasesPanel />
│    </div>
│  );
⋮

src\components\CycleStartDateCapture.tsx:
⋮
│export interface CycleStartDateCaptureProps {
│  caseId: string;
│  /**
│   * `temporalAnalysis` del dictamen vigente, o `null` si no hay dictamen
│   * emitido. Es `null` también cuando la interfaz recibe un assessment sin 
ese
│   * bloque: sin dictamen no hay nada que esta ventana venga a resolver.
│   */
│  assessment: { cycleStartDate: string | null; relationToCycleStart: string } 
| null;
│  cycleStartDate: string | null;
│  cycleStartDateByName: string | null;
⋮
│interface CapturedDate {
│  date: string;
│  byName: string | null;
│  at: string | null;
⋮

src\components\ErrorBoundary.tsx:
⋮
│interface State {
│  error: Error | null;
⋮

src\components\EvidenceUploader.tsx:
⋮
│export interface EvidenceUploaderProps {
│  caseId: string;
│  onUploaded?: () => void | Promise<void>;
│  disabled?: boolean;
⋮

src\components\LoginScreen.tsx:
⋮
│interface LoginScreenProps {
│  /** Mensaje del último rechazo del login, si el callback volvió con uno. */
│  authError?: string | null;
│  sessionExpired?: boolean;
⋮

src\components\NewCasePanel.tsx:
⋮
│type NoteArea = (typeof NOTE_AREAS)[number];
│
⋮
│interface EvidenceEntry {
│  /** Identidad de la fila, estable entre renders. Es lo que se quita. */
│  key: string;
│  file: File;
│  status: 'pending' | 'uploading' | 'error';
│  message?: string;
│  category?: string;
⋮
│interface EvidenceRow {
│  key: string;
│  name: string;
│  sizeBytes: number;
│  status: 'pending' | 'uploading' | 'error';
│  message?: string;
│  category?: string;
⋮

src\components\PdfCanvas.tsx:
⋮
│interface PdfDocumentProxy {
│  numPages: number;
│  getPage(pageNumber: number): Promise<PdfPageProxy>;
│  destroy(): Promise<void>;
⋮
│export interface PdfCanvasProps {
│  /** Mismo origen, con la cookie de sesión: devuelve los bytes con MIME 
`application/pdf`. */
│  url: string;
│  /** Nombre legible, para los lectores de pantalla y el error. */
│  filename: string;
⋮

src\components\dashboard\QualityPage.tsx:
⋮
│function HumanReviewNotice({ report }: { report: QualityReport | null }): 
ReactNode {
│  const message = report?.humanReview.message;
│  if (message === undefined) return null;
│
│  return (
│    <div className="flex flex-wrap items-start justify-between gap-3 
rounded-2xl border border-line
│      <div className="flex min-w-0 items-start gap-3">
│        <Info size={18} aria-hidden="true" className="mt-0.5 shrink-0 
text-muted" />
│        <p className="max-w-3xl text-sm text-muted">{message}</p>
│      </div>
⋮

src\components\dashboard\RecentCasesTable.tsx:
⋮
│function EvidenceBadge({ missing }: { missing: number }): ReactNode {
│  if (missing === 0) return <Badge tone="success">Completa</Badge>;
│  if (missing === 1) return <Badge tone="warning">Falta 1</Badge>;
⋮
│            <td className={cx('text-right', TD_CLASS)}>
│              <Button
│                variant="secondary"
│                className="px-3 py-1.5 text-xs"
│                aria-label={`Ver el caso ${row.shortId}`}
│                onClick={() => goToCase(row.caseId)}
│              >
│                Ver
│              </Button>
⋮

src\components\dashboard\charts\ConfidenceBandsChart.tsx:
⋮
│export interface ConfidenceBandsChartProps {
│  data: Band[];
│  /** Texto alternativo: qué mide y sobre cuántos dictámenes. */
│  ariaLabel: string;
⋮

src\components\dashboard\charts\ConfidenceByEvidenceChart.tsx:
⋮
│export interface ConfidenceByEvidenceChartProps {
│  data: Bucket[];
│  /** Texto alternativo: qué compara y cuál es la lectura principal. */
│  ariaLabel: string;
⋮

src\components\dashboard\charts\CostOverTimeChart.tsx:
⋮
│export interface CostOverTimeChartProps {
│  data: CostSeriesPoint[];
│  /** Texto alternativo del gráfico: periodo y magnitud, en una sola frase. */
│  ariaLabel: string;
⋮

src\components\dashboard\charts\EvolutionChart.tsx:
⋮
│export function EvolutionChart({ data }: { data: TimelinePoint[] }): ReactNode
{
│  if (data.length === 0) return null;
│
│  return (
│    <>
│      <ResponsiveContainer width="100%" height="100%">
│        <BarChart
│          data={data}
│          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
│          title="Evolución de casos por grupo de resolución"
⋮
│function timelineSummary(data: TimelinePoint[]): string {
│  const total = data.reduce(
│    (sum, point) => sum + point.granted + point.needsRuling + point.rejected +
point.insufficient,
│    0,
│  );
│  const conceded = data.reduce((sum, point) => sum + point.granted, 0);
│  const ruling = data.reduce((sum, point) => sum + point.needsRuling, 0);
│  const rejected = data.reduce((sum, point) => sum + point.rejected, 0);
│  const insufficient = data.reduce((sum, point) => sum + point.insufficient, 
0);
│  const detalle = data
⋮

src\components\ui.tsx:
⋮
│export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
│
⋮
│export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'>
{
│  title?: ReactNode;
│  description?: ReactNode;
│  actions?: ReactNode;
│  footer?: ReactNode;
│  tone?: Tone;
│  /** Titulo semantico del landmark. */
│  labelledBy?: string;
⋮

src\lib\api.ts:
⋮
│export type ResolutionSource = 'HUMAN' | 'AI';
│
⋮
│export type CoordinatorDecision = 'APPROVE' | 'CHANGE';
│
⋮
│export type WorkflowState = 'PENDING_ADVISOR' | 'PENDING_COORDINATOR' | 
'FINALIZED';
│
│export interface CaseSummary {
│  id: string;
│  status: CaseStatus;
│  studentIdentifier: string | null;
│  studentName?: string | null;
│  evidenceCount: number;
│  createdAt: string;
│  updatedAt: string;
│  /**
│   * Resolución vigente y su origen.
⋮
│export interface CaseDetail {
│  id: string;
│  status: CaseStatus;
│  studentIdentifier: string | null;
│  studentName?: string | null;
│  createdAt: string;
│  updatedAt: string;
│  /**
│   * Fecha de inicio de clases que aportó una persona, con su procedencia.
│   *
⋮
│export interface Evidence {
│  id: string;
│  caseId: string;
│  filename: string;
│  mimeType: string;
│  sizeBytes: number;
│  hash: string;
│  storagePath: string;
│  processingStatus: EvidenceStatus;
│  processingError: string | null;
⋮
│export type AuditRunStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';
│
⋮
│export interface AuditDetail {
│  id: string;
│  caseId: string;
│  status: AuditRunStatus;
│  provider: string;
│  model: string;
│  resultJson: AuditResult | null;
│  errorCategory: ErrorCategory | null;
│  latencyMs: number | null;
│  evidenceFingerprint: string | null;
⋮
│export interface CaseReviewDto {
│  id: string;
│  caseId: string;
│  /** Auditoría cuyo dictamen se compara. Inmutable: la revisión no apunta a 
"la última". */
│  auditId: string;
│  /** Resolución del ASESOR. No se sobrescribe con la decisión del 
Coordinador. */
│  result: AuditResultType;
│  /**
│   * Atribución DERIVADA por el servidor (correo de la sesión). El cliente 
nunca
│   * la envía: un `reviewerName` del navegador se rechaza en el schema 
estricto.
⋮
│export type ComparisonStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';
│
⋮
│export type AreaCommentArea = (typeof AREA_COMMENT_AREAS)[number];
│
⋮
│export interface AreaComment {
│  id: string;
│  caseId: string;
│  area: AreaCommentArea;
│  comment: string;
│  createdAt: string;
│  updatedAt: string;
⋮
│export interface ComparisonDto {
│  id: string;
│  caseReviewId: string;
│  auditId: string;
│  status: ComparisonStatus;
│  resultJson: ComparisonOutcomePayload | null;
│  provider: string;
│  model: string;
│  errorCategory: ErrorCategory | null;
│  latencyMs: number | null;
⋮
│export interface CaseDetailResponse {
│  case: CaseDetail;
│  evidences: Evidence[];
│  audit: AuditDetail | null;
│  audits: AuditHistoryItem[];
│  review: CaseReviewDto | null;
│  comparison: ComparisonDto | null;
│  effectiveResolution: EffectiveResolution | null;
│  /** Si el último dictamen completado usa evidencias y datos actuales. */
│  auditIsCurrent?: boolean | null;
⋮
│export interface ErrorState {
│  category: string;
│  message: string;
⋮
│export class ApiError extends Error {
│  readonly category: string;
│  readonly status: number;
│
│  constructor(category: string, message: string, status: number) {
│    super(message);
│    this.name = 'ApiError';
│    this.category = category;
│    this.status = status;
│  }
⋮
│export class SessionExpiredError extends ApiError {
│  constructor() {
│    super('UNAUTHENTICATED', 'Tu sesión expiró. Vuelve a iniciar sesión.', 
401);
│    this.name = 'SessionExpiredError';
│  }
⋮
│interface RequestOptions {
│  method?: string;
│  headers?: Record<string, string>;
│  body?: BodyInit;
⋮
│interface SafeFetchOptions extends RequestOptions {
│  /** Si es false, un 401 no dispara refresh automático. */
│  retryAuth?: boolean;
⋮

src\lib\dashboard-shared.ts:
⋮
│export type DashboardFilters = {
│  from: string;
│  to: string;
│  result: string | null;
│  status: string | null;
⋮
│export type ExecutionOutcome =
│  | 'SUCCESS_FIRST_ATTEMPT'
│  | 'SUCCESS_AFTER_RETRY'
│  | 'SUCCESS_WITH_FALLBACK'
⋮

src\lib\dashboard.ts:
⋮
│export type CostGranularity = 'day' | 'week' | 'month';
│
⋮

src\lib\layout.ts:
⋮
│export function isDashboardRoute(name: AppRoute['name']): boolean {
│  return DASHBOARD_ROUTES.has(name);
⋮
│export function shellWidth(name: AppRoute['name']): string {
│  return isDashboardRoute(name) ? 'max-w-6xl' : 'max-w-5xl';
⋮

src\lib\useEvidenceUpload.ts:
⋮
│export type UploadStatus = 'uploading' | 'done' | 'error';
│
│export interface UploadItem {
│  id: string;
│  /** El archivo real, para poder reconciliar la fila al reintentar. */
│  file: File;
│  name: string;
│  sizeBytes: number;
│  status: UploadStatus;
│  message?: string;
│  category?: string;
⋮
│export interface EvidenceUploadController {
│  items: UploadItem[];
│  busy: boolean;
│  announcement: string;
│  /**
│   * Sube un lote de forma SECUENCIAL. Nunca lanza: el fallo de un archivo no
│   * cancela el resto y queda registrado en su propia fila.
│   *
│   * El `caseId` es un ARGUMENTO y no el del hook a propósito: en el alta se
│   * conoce justo después de `createCase`, dentro de la misma pulsación. 
Cerrar
⋮

src\lib\useHashRoute.ts:
⋮
│export type AppRoute =
│  | { name: 'dashboard' } // #/
│  | { name: 'quality' } // #/calidad
│  | { name: 'ai-costs' } // #/ia-costos
│  | { name: 'new-case' } // #/nuevo
│  | { name: 'cases' } // #/casos
⋮

src\lib\usePolling.ts:
⋮
│export function usePolling(task: () => Promise<void>, intervalMs: number | 
null): void {
│  const taskRef = useRef(task);
│
│  useEffect(() => {
│    taskRef.current = task;
│  });
│
│  useEffect(() => {
│    if (intervalMs === null) return;
│    let cancelled = false;
⋮

src\lib\useSession.ts:
⋮
│export type SessionStatus = 'loading' | 'anon' | 'authed';
│
⋮
│export interface UseSessionResult {
│  status: SessionStatus;
│  /** Indica si la transición a 'anon' fue por sesión expirada (vs. carga 
inicial). */
│  sessionExpired: boolean;
│  /** Motivo del último rechazo del login por Google, si lo hubo. */
│  authError: string | null;
│  /**
│   * Rol resuelto por el servidor, SOLO para presentación. `null` cuando no 
hay
│   * sesión o el rol no se reconoce; la autorización sigue en el servidor.
│   */
⋮

src\server\ai\model-capabilities.ts:
⋮
│export interface ModelCapabilityProfile {
│  provider: string;
│  schemaProfile: 'gemini' | 'openai';
│  safeOutputLimit: number;
│  recommendedOutputTokens: number;
│  retryFallbackSuitable: boolean;
⋮
│export interface ModelCapabilities {
│  modelId: string;
│  provider: string;
│  maxOutputTokens: number;
│  recommendedOutputTokens: number;
│  /** Tope seguro definido por la aplicación; pedir más que esto es un error 
de configuración. */
│  appSafeOutputLimit: number;
│  /** Tope efectivo: el menor entre el de la aplicación y el máximo publicado 
por el modelo. */
│  safeOutputLimit: number;
│  contextLength: number;
⋮
│export class CapabilityCatalogUnavailableError extends Error {
│  constructor() {
│    super('CAPABILITY_CATALOG_UNAVAILABLE');
│    this.name = 'CapabilityCatalogUnavailableError';
│  }
⋮

src\server\ai\provider-schema.ts:
⋮
│export type ProviderSchemaProfile = 'gemini' | 'openai';
│
⋮

src\server\area-comments.ts:
⋮
│export type AreaCommentArea = (typeof AREA_COMMENT_AREAS)[number];
│
⋮

src\server\auth.ts:
⋮
│export interface AuthContext {
│  readonly sub: string;
│  readonly email: string;
│  readonly role: AppRole;
⋮

src\server\capabilities.ts:
⋮
│export interface AuthCapabilities {
│  readonly canReadAllCases: boolean;
│  readonly canReviewOwnCases: boolean;
│  readonly canFinalizeAnyCase: boolean;
│  readonly canWriteOwnedCases: boolean;
│  readonly canManageCases: boolean;
⋮

src\server\cases.ts:
⋮
│export interface CaseSummaryRow extends CaseRow {
│  evidence?: Array<{ count: number }> | null;
│  /** Resolución humana del caso (cargada en batch junto con el listado). */
│  review?: CaseReviewRow | null;
│  /** Auditoría COMPLETED vigente del caso (cargada en batch junto con el 
listado). */
│  audit?: AuditRow | null;
│  /** Si la última auditoría completada usa los datos actuales del expediente.
*/
│  auditIsCurrent?: boolean | null;
⋮
│export interface EvidenceRow {
│  id: string;
│  case_id: string;
│  filename: string;
│  mime_type: string;
│  size_bytes: number;
│  hash: string;
│  storage_path: string;
│  processing_status: EvidenceStatus;
│  transcript_json: unknown;
⋮
│export type AuditStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';
│
│export interface AuditRow {
│  id: string;
│  case_id: string;
│  status: AuditStatus;
│  provider: string;
│  model: string;
│  result_json: unknown;
│  error_category: ErrorCategory | null;
│  latency_ms: number | null;
│  evidence_fingerprint: string | null;
⋮

src\server\dashboard-contracts.ts:
⋮
│export interface DashboardMetricRow {
│  id: string;
│  case_id: string;
│  case_status: CaseStatus;
│  student_identifier: string | null;
│  audit_status: AuditStatus;
│  model: string;
│  provider: string;
│  latency_ms: number | null;
│  error_category: ErrorCategory | null;
⋮

src\server\dashboard-costs.ts:
⋮
│export type CostGranularity = 'day' | 'week' | 'month';
│
⋮

src\server\dashboard-utils.ts:
⋮
│export function utcDayBucket(iso: string): string {
│  const ms = Date.parse(iso);
│  if (Number.isNaN(ms)) return iso.slice(0, 10);
│  return new Date(ms).toISOString().slice(0, 10);
⋮
│export function millisOf(iso: string): number {
│  const ms = Date.parse(iso);
│  return Number.isNaN(ms) ? 0 : ms;
⋮
│export function percentage(part: number, total: number): number {
│  if (total <= 0) return 0;
│  const value = (part / total) * 100;
│  if (!Number.isFinite(value)) return 0;
│  return Math.round(value * 10) / 10;
⋮
│export function round3(value: number): number {
│  return Math.round(value * 1000) / 1000;
⋮

src\server\derived.ts:
⋮
│export interface DerivedExtractionCarrier {
│  extracted_text?: string | null;
│  extraction_pipeline_version?: string | null;
⋮

src\server\dto.ts:
⋮
│export interface CaseReviewDto {
│  id: string;
│  caseId: string;
│  /** Auditoría cuyo dictamen se compara (inmutable). */
│  auditId: string;
│  result: string;
│  reviewerName: string | null;
│  comment: string;
│  createdAt: string;
│  coordinatorDecision: CoordinatorDecision | null;
⋮
│export interface ComparisonDto {
│  id: string;
│  caseReviewId: string;
│  auditId: string;
│  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
│  agrees: boolean | null;
│  explanation: string | null;
│  confidence: number | null;
│  discrepancyReason: string | null;
│  procedureSections: string[];
⋮

src\server\env.ts:
⋮
│export interface ServerEnv {
│  // InsForge
│  INSFORGE_BASE_URL: string;
│  INSFORGE_ANON_KEY: string;
│  /** Clave administrativa; solo se usa en funciones server-side. */
│  INSFORGE_API_KEY: string;
│  /** Bucket de InsForge Storage para evidencias. */
│  INSFORGE_STORAGE_BUCKET: string;
│
│  // IA
⋮

src\server\errors.ts:
⋮
│export type ValidatorFailureCode = 'INVALID_EVIDENCE_REFERENCE';
│
⋮
│export class ApiError extends Error {
│  readonly status: number;
│  readonly category: ErrorCategory;
│  /** Segundos que el cliente debe esperar antes de reintentar (rate 
limiting). */
│  retryAfterSeconds?: number;
│  /**
│   * Detalle estructurado SANEADO para observabilidad (diagnósticos de 
intento,
│   * logs y `provider_metadata`). Sólo puede contener texto estático emitido 
por
│   * el propio emisor o códigos de error (p. ej. `ZodError.issue.code`): NUNCA
│   * contenido de la respuesta del modelo ni PII. Si no puede garantizarse, no
⋮

src\server\http.ts:
⋮
│export interface ApiRequest extends IncomingMessage {
│  /** Params de ruta + query string (Vercel inyecta aquí los params 
`[casoId]`). */
│  query: Record<string, QueryValue>;
│  /** Body JSON ya parseado (en Vercel lo hace el runtime; en dev lo hace 
dev-api.mjs). */
│  body?: unknown;
│  /** Contexto de autenticación resuelto por `handleRoute` (o inyectado en 
tests). */
│  auth?: AuthContext;
⋮
│export type ApiResponse = ServerResponse;
│
│export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<void> 
| void;
│
⋮
│export interface CookieOptions {
│  maxAgeSeconds: number;
│  httpOnly?: boolean;
│  secure?: boolean;
│  sameSite?: 'Lax' | 'Strict' | 'None';
│  path?: string;
⋮

src\server\openrouter.ts:
⋮
│export interface OpenRouterAttemptDiagnostic {
│  model: string;
│  format: 'json_schema' | 'json_object' | 'capability';
│  status: number | null;
│  providerErrorType: string | null;
│  finishReason: string | null;
│  latencyMs: number;
│  promptTokens: number | null;
│  completionTokens: number | null;
│  totalTokens: number | null;
⋮

src\server\pdf.ts:
⋮
│interface PdfTextItem {
│  str?: string;
⋮
│export async function extractPdfText(buffer: Buffer): Promise<string> {
│  const document = await getDocument({
│    data: new Uint8Array(buffer),
│    useWorkerFetch: false,
│    isEvalSupported: false,
│    disableFontFace: true,
│  }).promise;
│
│  try {
│    const pages: string[] = [];
⋮

src\skills\audit\procedure-v5.ts:
⋮
│export interface PolicyManifest {
│  code: string;
│  title: string;
│  version: string;
│  sourceFile: string;
│  sourceSha256: string;
│  sections: PolicySection[];
⋮

src\skills\audit\schema.ts:
⋮
│export type AuditResult = z.infer<typeof AuditResultSchema>;
│
⋮

src\skills\audit\types.ts:
⋮
│export type AuditResultType = (typeof AUDIT_RESULTS)[number];
│
⋮
│export type CaseStatus = (typeof CASE_STATUSES)[number];
│
⋮
│export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
│
⋮
│export type TemporalRelation = (typeof TEMPORAL_RELATIONS)[number];
│
⋮
│export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
│
⋮
│export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
│
⋮
│export interface AuditSkillInput {
│  caseId: string;
│  studentIdentifier: string | null;
│  evidences: EvidenceInputItem[];
│  /**
│   * Contexto de otras áreas (Back Office / HelpDesk) que SÍ entra al 
expediente.
│   *
│   * `comment` llega YA cercado con `wrapUntrusted`; el Skill solo lo inserta
│   * como bloque y lo snapshottea en el resultado. `undefined` y `[]` 
significan
│   * lo mismo para el expediente (no hay contexto), pero el snapshot 
distingue:
⋮
│export type AreaCommentScope = (typeof AREA_COMMENT_SCOPES)[number];
│
⋮
│export interface ModelUsage {
│  promptTokens: number | null;
│  completionTokens: number | null;
│  totalTokens: number | null;
│  estimatedCostUSD: number | null;
⋮
│export interface TemporalAnalysis {
│  /** Fecha real de inicio de ciclo/clases en ISO `YYYY-MM-DD`, o null si no 
está acreditada. */
│  cycleStartDate: string | null;
│  /** Evidencias que acreditan explícitamente el inicio académico. */
│  cycleStartEvidenceIds: string[];
│  /** Cita textual que acredita el inicio académico. */
│  cycleStartEvidenceText: string | null;
│  /** Fecha en que el estudiante expresó que no quería continuar, o null. */
│  cancellationRequestDate: string | null;
│  /** Evidencias que acreditan la fecha de la solicitud. */
⋮

src\skills\review\types.ts:
⋮
│export type HumanResolution = (typeof HUMAN_RESOLUTIONS)[number];
│
⋮
│export type CoordinatorDecision = (typeof COORDINATOR_DECISIONS)[number];
│
⋮
│export type WorkflowState = (typeof WORKFLOW_STATES)[number];
│
⋮
│export type ComparisonStatus = (typeof COMPARISON_STATUSES)[number];
│
⋮

src\skills\sanitize.ts:
⋮
│export function sanitizeTagDelimiters(text: string): string {
│  return text.replace(/</g, '\uFF1C').replace(/>/g, '\uFF1E');
⋮
│export function sanitizeFenceDelimiters(text: string): string {
│  return text.replace(/===/g, '= =');
⋮
│function stripControlChars(text: string): string {
│  // eslint-disable-next-line no-control-regex
│  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
⋮
│export function wrapUntrusted(label: string, content: string): string {
│  const safeLabel = stripControlChars(sanitizeTagDelimiters(label)).slice(0, 
200);
│  const body = 
stripControlChars(sanitizeFenceDelimiters(sanitizeTagDelimiters(content)));
│  return [
│    `${UNTRUSTED_OPEN} [${safeLabel}]`,
│    body.length > 0 ? body : '(sin contenido)',
│    UNTRUSTED_CLOSE,
│  ].join('\n');
⋮
│export function wrapUntrustedInline(label: string, content: string): string {
│  const safe = 
stripControlChars(sanitizeFenceDelimiters(sanitizeTagDelimiters(content)))
│    .replace(/\s*\n\s*/g, ' ')
│    .trim();
│  return `${label}: ${safe.length > 0 ? safe : '(vacío)'}`;
⋮

tests\auth-smoke.test.ts:
⋮
│function jsonResponse(status: number, body: unknown): Response {
│  return {
│    status,
│    json: async () => body,
│  } as unknown as Response;
⋮

tests\case-dimensions.test.ts:
⋮
│interface UpdateCall {
│  patch: Record<string, unknown>;
│  column: string;
│  value: unknown;
⋮

tests\cases-pagination.test.ts:
⋮
│function database(rows: Row[], related: Record<string, Row[]> = {}) {
│  const ranges: Array<[string, number, number]> = [];
│  const filters: Array<[string, string, unknown]> = [];
│  const client = {
│    database: {
│      from(table: string) {
│        let page: [number, number] = [0, 9999];
│        let predicates: Array<[string, string, unknown]> = [];
│        const orders: Array<[string, boolean]> = [];
│        const query = {
│          select() { return query; },
│          eq(column: string, value: unknown) { predicates.push([column, 'eq', 
value]); return query
│          lte(column: string, value: unknown) { predicates.push([column, 
'lte', value]); return que
│          in(column: string, value: unknown[]) { predicates.push([column, 
'in', value]); return que
│          order(column: string, options?: { ascending?: boolean }) { 
orders.push([column, options?.
│          range(from: number, to: number) { page = [from, to]; return query; 
},
│          then(resolve: (value: unknown) => unknown) {
│            filters.push(...predicates);
│            ranges.push([table, page[0], page[1]]);
│            const matches = (rowsForTable: Row[]) => rowsForTable.filter((row)
=> predicates.every(
│              if (op === 'eq') return row[column] === value;
│              if (op === 'in') return (value as 
unknown[]).includes(row[column]);
│              return String(row[column] ?? '') <= String(value);
│            }));
│            let found = matches(table === 'cases' ? rows : related[table] ?? 
[]);
│            if (table === 'cases') found = found.map((row) => ({ ...row, 
evidence: [] }));
⋮

tests\dashboard-human-review-query.test.ts:
⋮
│interface QueryResult {
│  data: Row[] | null;
│  error: unknown;
│  count: number | null;
⋮

tests\evidence-mime-detection.test.ts:
⋮
│function makeFetchMock(status = 201) {
│  return vi.fn().mockResolvedValue(
│    new Response(
│      JSON.stringify({
│        evidence: {
│          id: 'ev-1',
│          caseId: 'case-1',
│          filename: 'captura.png',
│          mimeType: 'image/jpeg',
│          sizeBytes: JPEG_BYTES.length,
⋮

tests\helpers\env.ts:
⋮
│export function setTestEnv(): void {
│  for (const [key, value] of Object.entries(REQUIRED_VARS)) {
│    process.env[key] = value;
│  }
│  resetEnvCache();
⋮

tests\helpers\fake-database.ts:
⋮
│type QueryResult = { data: Row[] | Row | null; error: null };
│
│class FakeQuery implements PromiseLike<QueryResult> {
│  private readonly filters: Array<[string, unknown, 'eq' | 'is']> = [];
│  private readonly orders: Array<[string, boolean]> = [];
│  private limitCount: number | null = null;
│
│  constructor(
│    private readonly db: FakeDatabaseImpl,
│    private readonly table: string,
│    private readonly op: Op,
│    private readonly payload: Row[] | null = null,
⋮
│class FakeDatabaseImpl {
│  private readonly tables = new Map<string, Row[]>();
│  private sequence = 0;
│
│  rows(table: string): Row[] {
│    let found = this.tables.get(table);
│    if (!found) {
│      found = [];
│      this.tables.set(table, found);
│    }
⋮
│export interface FakeDatabase {
│  /** Cliente InsForge fake, listo para `createCaseReview(fake, ...)`. */
│  client: InsForgeClient;
│  /** Copia de las filas de una tabla (para observar qué se escribió). */
│  rows(table: string): Row[];
│  /**
│   * Siembra una fila CRUDO, sin pasar por el cliente ni por una función de
│   * producción.
│   *
│   * Hace falta cuando la fila que hay que sembrar no se puede crear con la
⋮

tests\model-capabilities.test.ts:
⋮
│function catalogResponse(model: unknown): Response {
│  return new Response(JSON.stringify({ data: [model] }), { status: 200 });
⋮

tests\paid-quota.test.ts:
⋮
│describe('R11 · la fecha de inicio del equipo entra en la huella solo cuando 
existe', () => {
│  /** La huella con la que el caso buscó un dictamen COMPLETED reutilizable. 
*/
│  function reusedFingerprint(): string | undefined {
│    const call = 
vi.mocked(latestCompletedAuditByFingerprint).mock.calls.at(-1);
│    return call?.[2];
│  }
│
│  beforeEach(() => {
│    vi.mocked(latestCompletedAuditByFingerprint).mockClear();
│  });
│
⋮

vite.config.ts:
⋮
│const devApiPlugin: Plugin = {
│  name: 'dev-api',
│  apply: 'serve',
│  configureServer(server) {
│    // NO devolver la función desde `configureServer`: Vite la ejecutaría como
│    // post-hook y la registraría DETRÁS de sus middlewares internos
│    // (transform -> serveStatic -> htmlFallback), por lo que `/api/*` nunca
│    // llegaría al handler y `serveStatic` serviría el archivo .ts desde 
disco.
│    // El registro tiene que ser síncrono y directo.
│    server.middlewares.use(createDevApiMiddleware(server));
⋮
│function chartChunk(id: string): string | undefined {
│  if (!id.includes('node_modules')) return undefined;
│  if (id.includes('recharts') || id.includes('react-redux') || 
id.includes('@reduxjs')) {
│    return 'recharts';
│  }
│  if (id.includes('immer') || id.includes('reselect') || 
id.includes('decimal.js')) {
│    return 'recharts';
│  }
│  return undefined;
⋮
