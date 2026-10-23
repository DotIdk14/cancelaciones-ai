Detected dumb terminal, disabling fancy input and pretty output.

Using openrouter/deepseek/deepseek-r1:free model with API key from environment.
Aider v0.86.2
Model: openrouter/deepseek/deepseek-r1:free with diff edit format, prompt 
cache, infinite output
Git repo: .git with 395 files
Repo-map: using 4096 tokens, auto refresh
Here are summaries of some files present in my git repository.
Do not propose changes to these files, treat them as *read-only*.
If you need to edit any of these files, ask me to *add them to the chat* first.

.opencode\plugins\repo-map-freshness.ts:
⋮
│function checkFreshness(): Promise<void> {
│  return new Promise((resolve) => {
│    const child = spawn(
│      "powershell.exe",
│      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", 
"Check"],
│      { stdio: "ignore", windowsHide: true },
│    )
│    child.once("error", (error) => {
│      console.error(`[repo-map] No se pudo comprobar la frescura: 
${error.message}`)
│      resolve()
⋮
│export default Plugin.define({
│  id: "cancelaciones.repo-map-freshness",
│  async setup(ctx) {
│    await checkFreshness()
│    await ctx.session.hook("prompt", async () => {
│      await checkFreshness()
│    })
│  },
⋮

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

src\components\AppDock.tsx:
⋮
│type Capabilities = SessionSnapshot['capabilities'];
│
⋮

src\components\AppHeader.tsx:
⋮
│interface AppHeaderProps {
│  onSignOut?: () => void;
│  previewOnly?: boolean;
│  role?: AppRole | null;
│  onReportProblem?: () => void;
⋮

src\components\AuditProgressSteps.tsx:
⋮
│export interface AuditProgressStage {
│  label: string;
│  status: 'done' | 'attention' | 'current' | 'pending';
⋮

src\components\CaseListPage.tsx:
⋮
│export function CaseListPage({ canReadAllCases = false, canFinalizeAnyCase = 
false }: { canReadAllC
│  return (
│    <div className="flex flex-col gap-5">
│      <CasesPanel canReadAllCases={canReadAllCases} 
canFinalizeAnyCase={canFinalizeAnyCase} />
│    </div>
│  );
⋮

src\components\ContinuousImprovementPage.tsx:
⋮
│type Tab = 'feedback' | 'examples' | 'versions' | 'lab';
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

src\components\EvidenceReferences.tsx:
⋮
│export function referencedSeconds(text: string): Array<{ label: string; 
seconds: number }> {
│  return 
Array.from(text.matchAll(/(?<![\d:])(\d{1,2}:\d{2}(?::\d{2})?)(?![\d:])/g)).fla
tMap((match
│    const label = match[1]!;
│    const parts = label.split(':').map(Number);
│    if (parts.slice(1).some((value) => value > 59)) return [];
│    return [{ label, seconds: parts.reduce((total, value) => total * 60 + 
value, 0) }];
│  });
│}
│export function EvidenceReferences({ text, evidenceIds, evidences, onOpen }: {
│  text: string; evidenceIds: string[]; evidences: Evidence[];
│  onOpen: (id: string, seconds: number | null) => void;
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

src\components\OperationProgressDialog.tsx:
⋮
│export function ModalShell({ title, onClose, children, variant = 'modal', 
subtitle, open = true, no
│  const ref = useRef<HTMLDialogElement>(null);
│  const titleId = useId();
│  const isContextOverlay = className.split(' ').includes('case-context-menu');
│  useEffect(() => {
│    if (!open || !nonModal) return;
│    const outside = (event: PointerEvent): void => {
│      const target = event.target as Node;
│      if (ref.current?.contains(target) || (target instanceof Element && 
target.closest('[aria-cont
│      // Los diálogos modales de la capa superior conservan su interacción.
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
│          title="Auditorías por día y resultado"
⋮
│function timelineSummary(data: TimelinePoint[]): string {
│  const total = data.reduce(
│    (sum, point) => sum + point.granted + point.needsRuling + point.rejected +
point.insufficient,
│    0,
│  );
│  const approved = data.reduce((sum, point) => sum + point.granted, 0);
│  const needsReview = data.reduce((sum, point) => sum + point.needsRuling, 0);
│  const declined = data.reduce((sum, point) => sum + point.rejected, 0);
│  const missingEvidence = data.reduce((sum, point) => sum + 
point.insufficient, 0);
│  const detalle = data
⋮

src\components\ui.tsx:
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
│export type WorkflowState = 'PENDING_ADVISOR' | 'PENDING_COORDINATOR' | 
'FINALIZED';
│
│export interface CaseSummary {
│  id: string;
│  externalCaseId?: string | null;
│  status: CaseStatus;
│  studentIdentifier: string | null;
│  studentName?: string | null;
│  evidenceCount: number;
│  createdAt: string;
│  updatedAt: string;
│  /** Etapa humana derivada de case_reviews; no corresponde a cases.status. */
⋮
│export type CaseCreatorRole = 'user' | 'coordinator' | 'manager';
│
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
│  /** Revisiones humanas ligadas a cada auditoría del expediente, recientes 
primero. */
│  reviews?: CaseReviewDto[];
│  canUploadEvidence?: boolean;
│  canDeleteEvidence?: boolean;
⋮
│export class ApiError extends Error {
│  readonly category: string;
│  readonly status: number;
│  readonly correlationId?: string;
│
│  constructor(category: string, message: string, status: number, 
correlationId?: string) {
│    super(message);
│    this.name = 'ApiError';
│    this.category = category;
│    this.status = status;
⋮
│export type IncidentModule = 'Resumen' | 'Calidad' | 'IA y Costos' | 
'Expedientes' | 'Nueva auditor
│export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
⋮
│export interface IncidentTicketDto {
│  id: string;
│  reporter_email: string;
│  module: IncidentModule;
│  description: string;
│  status: IncidentStatus;
│  context: { route?: string; correlationId?: string };
│  created_at: string;
│  updated_at: string;
│  events: TicketEventDto[];
⋮

src\lib\audit-lifecycle.ts:
│export type AuditLifecycle =
⋮

src\lib\case-workflow.ts:
⋮
│export type CaseBucket = (typeof CASE_BUCKETS)[number]['value'];
│export type CaseStage = (typeof CASE_STAGES)[number]['value'];
⋮
│interface WorkflowSummary {
│  status: string;
│  evidenceCount: number;
│  workflowState?: string;
│  auditIsCurrent?: boolean | null;
│  effectiveResolution?: { source: string } | null;
⋮

src\lib\currency.ts:
⋮
│export function usdToMxn(value: number): number {
│  return value * MXN_REFERENCE_RATE.pesosPerUsd;
⋮
│export function formatCostMxn(value: number | null | undefined, unavailable = 
'No disponible'): str
│  if (typeof value !== 'number' || !Number.isFinite(value)) return 
unavailable;
│  return `$${mexicanPesos.format(usdToMxn(value))} MXN`;
⋮

src\lib\dashboard-metrics-contracts.ts:
⋮
│export type EvaluationState = 'AGREEMENT' | 'DISAGREEMENT' | 'PENDING_ADVISOR'
| 'PENDING_COORDINAT
│
│export interface ActivityMetrics {
│  executions: number;
│  completed: number;
│  failed: number;
│  running: number;
│  uniqueCases: number;
│  uniqueStudents?: number;
│  uniqueCaveTickets?: number;
│  reaudits: number;
│  retried: number;
⋮

src\lib\dashboard-shared.ts:
⋮
│export type DashboardFilters = {
│  from: string;
│  to: string;
│  result: string | null;
│  status: string | null;
│  evaluation?: string | null;
⋮

src\lib\flokzu-administrative.ts:
⋮
│export function normalizeAdministrativeText(value: string): string {
│  return value.replace(/_x000D_/gi, '\n').replace(/<br\s*\/?\s*>|<\/p>/gi, 
'\n')
│    .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
│    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
│    .replace(/\r\n?/g, '\n').replace(/[\t \u00a0]+/g, ' ').replace(/ *\n */g, 
'\n').replace(/\n{3,}
⋮
│export function usefulAdministrativeText(value: string): boolean {
│  return !/^(?:|99|sin dato|sin datos|n\/a|no aplica|pendiente|seguimiento|se 
da seguimiento)[.! ]*
⋮

src\lib\layout.ts:
⋮
│export function isDashboardRoute(name: AppRoute['name']): boolean {
│  return DASHBOARD_ROUTES.has(name);
⋮
│export function shellWidth(name: AppRoute['name']): string {
│  return isDashboardRoute(name) ? 'max-w-6xl' : 'max-w-5xl';
⋮

src\lib\student-history.ts:
│export type RelationKind =
⋮

src\lib\useHashRoute.ts:
⋮
│export type AppRoute =
│  | { name: 'dashboard' } // #/
│  | { name: 'quality' } // #/calidad
│  | { name: 'ai-costs' } // #/ia-costos
│  | { name: 'new-case' } // #/nuevo
│  | { name: 'cases' } // #/casos
│  | { name: 'incidents' } // #/incidencias
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
│  readonly canImportCases: boolean;
│  /** Puede validar feedback humano, sin adquirir permisos de cierre de casos.
*/
│  readonly canValidateAuditFeedback: boolean;
│  /** Puede administrar versiones, datasets, experimentos y promoción del 
auditor. */
⋮

src\server\cases.ts:
⋮
│export type CaseCreatorRole = 'user' | 'coordinator' | 'manager';
│
⋮
│export type AuditStatus = 'RUNNING' | 'COMPLETED' | 'ERROR';
│
⋮

src\server\dashboard-contracts.ts:
⋮
│export interface DashboardMetricRow {
│  execution_kind?: 'AUDIT' | 'COMPARISON';
│  call_metrics?: Array<{model: string; cost: number | null}> | null;
│  usage_is_aggregate?: boolean;
│  is_reaudit?: boolean;
│  cost_incomplete?: boolean;
│  tokens_incomplete?: boolean;
│  id: string;
│  case_id: string;
│  case_status: CaseStatus;
⋮

src\server\dashboard-responsibles.ts:
⋮
│export async function responsibleNames(client: InsForgeClient, values: 
Array<string | null>): Promi
│  const ids = [...new Set(values.filter((value): value is string => typeof 
value === 'string' && /^
│  const names: Record<string, string> = {};
│  for (let offset = 0; offset < ids.length; offset += 10) {
│    await Promise.all(ids.slice(offset, offset + 10).map(async id => {
│      try {
│        const { data } = await client.auth.getProfile(id);
│        const profile = data as { name?: unknown; profile?: { name?: unknown }
| null } | null;
│        const name = profile?.name ?? profile?.profile?.name;
│        if (typeof name === 'string' && name.trim()) names[id] = 
name.trim().slice(0, 200);
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
│  /** Identidad de la petición compartida por respuesta, auditoría y logs. */
│  correlationId?: string;
⋮
│export type ApiResponse = ServerResponse;
│
⋮

src\server\incidents.ts:
⋮
│export type IncidentModule = (typeof INCIDENT_MODULES)[number];
│
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
│    standardFontDataUrl,
│  }).promise;
│
│  try {
⋮

src\shared\case-links.ts:
│export interface ManualCaseMatch {
⋮
│export interface ImportLinkResolution { externalCaseId: string; caseId: string
| null }

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

tests\assignment-linking.test.ts:
⋮
│type Case = { id: string; assigned_to: string | null; created_by: string; 
external_case_id: string 
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
│    auth: { async getProfile(id: string) { return { data: { name: id === 
'advisor-a' ? 'Ana Pérez' 
│    database: {
│      from(table: string) {
│        let page: [number, number] = [0, 9999];
│        let predicates: Array<[string, string, unknown]> = [];
│        let disjunction: Array<[string, unknown]> = [];
│        const orders: Array<[string, boolean]> = [];
│        const query = {
│          select() { return query; },
│          eq(column: string, value: unknown) { predicates.push([column, 'eq', 
value]); return query
│          is(column: string, value: unknown) { predicates.push([column, 'is', 
value]); return query
│          lte(column: string, value: unknown) { predicates.push([column, 
'lte', value]); return que
│          in(column: string, value: unknown[]) { predicates.push([column, 
'in', value]); return que
│          or(expression: string) { filters.push(['created_by|assigned_to', 
'or', expression]); disj
│          order(column: string, options?: { ascending?: boolean }) { 
orders.push([column, options?.
│          range(from: number, to: number) { page = [from, to]; return query; 
},
│          then(resolve: (value: unknown) => unknown) {
⋮
│function caseRows(count: number): Row[] {
│  return Array.from({ length: count }, (_, index) => ({
│    id: `case-${String(index).padStart(5, '0')}`,
│    status: 'READY',
│    student_identifier: `student-${index}`,
│    created_by: FAKE_USER_SUB,
│    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
│    updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
│  }));
⋮

tests\dashboard-human-review-query.test.ts:
⋮
│async function caseRow(value = 1, test = false): Promise<void> {
│  await db.query('INSERT INTO 
cases(id,country,campus,responsible,guideline,is_test,external_case_i
⋮
│async function review(auditId = 11, final: 'APPROVE' | 'CHANGE' | null = 
'APPROVE'): Promise<void> 
│  await db.query('INSERT INTO 
case_reviews(id,case_id,audit_id,result,coordinator_decision,coordina
│    [id(21), id(1), id(auditId), 'BAJA', final, final === 'CHANGE' ? 
'CANCELACION_VENTA' : null, fi
│}
│async function comparison(status = 'COMPLETED', agrees = true, at = 
'2026-10-12T12:00:00Z'): Promis
│  await db.query('INSERT INTO 
case_comparisons(id,case_review_id,audit_id,status,provider,model,cre
│    [id(31), id(21), id(11), status, 'openrouter', 'test/model', at, status 
=== 'COMPLETED' ? { agr
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

tests\helpers\fake-database.ts:
⋮
│type QueryResult = { data: Row[] | Row | null; error: null };
│
│class FakeQuery implements PromiseLike<QueryResult> {
│  private readonly filters: Array<[string, unknown, 'eq' | 'is']> = [];
│  private readonly notNullFilters: string[] = [];
│  private readonly orders: Array<[string, boolean]> = [];
│  private limitCount: number | null = null;
│  private rangeStart = 0;
│  private rangeEnd: number | null = null;
│
│  constructor(
│    private readonly db: FakeDatabaseImpl,
⋮
│class FakeDatabaseImpl {
│  private readonly tables = new Map<string, Row[]>();
│  private sequence = 0;
│  readonly removedStoragePaths: string[] = [];
│
│  rows(table: string): Row[] {
│    let found = this.tables.get(table);
│    if (!found) {
│      found = [];
│      this.tables.set(table, found);
⋮
│export interface FakeDatabase {
│  /** Cliente InsForge fake, listo para `createCaseReview(fake, ...)`. */
│  client: InsForgeClient;
│  /** Copia de las filas de una tabla (para observar qué se escribió). */
│  rows(table: string): Row[];
│  /** Rutas retiradas del Storage por el cliente fake. */
│  removedStoragePaths: string[];
│  /**
│   * Siembra una fila CRUDO, sin pasar por el cliente ni por una función de
│   * producción.
⋮

tests\historical-audit-read.test.ts:
⋮
│async function read(id: string, authenticated = true) {
│  const output = { statusCode: 200, body: '', setHeader: vi.fn(), end(value: 
string) { this.body = 
│  await caseHandler({ method: 'GET', headers: {}, query: { caseId, auditId: id
}, ...(authenticated
│  return { status: output.statusCode, payload: JSON.parse(output.body) };
│}
│function seed(ownerId = caseId) { db.seed('audits', { id: auditId, case_id: 
ownerId, status: 'COMPL
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
