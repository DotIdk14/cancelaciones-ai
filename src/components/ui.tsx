// =============================================================================
// Primitivas visuales del producto. Estilo: tarjetas redondeadas sobre fondo
// oscuro usando las variables CSS de `index.css` mapeadas en Tailwind.
//
// Contraste: el texto de contenido usa `text-ink` (16.9:1) y `text-muted`
// (8.4:1) sobre `bg-surface-1`. `text-subtle` (4.2:1) queda reservado a
// elementos decorativos/ilustrativos, nunca a texto informativo pequeno.
// =============================================================================

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'border-line bg-surface-3 text-muted',
  brand: 'border-brand/40 bg-brand/10 text-brand',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
};

const TONE_SURFACE: Record<Tone, string> = {
  neutral: 'bg-surface-1',
  brand: 'bg-brand/5',
  success: 'bg-success/5',
  warning: 'bg-warning/5',
  danger: 'bg-danger/5',
};

// -----------------------------------------------------------------------------
// Panel
// -----------------------------------------------------------------------------

// `title` se redefine como ReactNode para el encabezado del panel.
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: Tone;
  /** Titulo semantico del landmark. */
  labelledBy?: string;
}

export function Panel({
  title,
  description,
  actions,
  footer,
  tone = 'neutral',
  labelledBy,
  className,
  children,
  ...rest
}: PanelProps): ReactNode {
  const headingId = labelledBy;
  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        'rounded-xl border border-line bg-surface-1',
        TONE_SURFACE[tone],
        className,
      )}
      {...rest}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 id={headingId} className="text-base font-semibold text-ink">
                {title}
              </h2>
            )}
            {description !== undefined && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
      {footer !== undefined && <div className="border-t border-line px-5 py-3">{footer}</div>}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Badge
// -----------------------------------------------------------------------------

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', children, className, title }: BadgeProps): ReactNode {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Spinner
// -----------------------------------------------------------------------------

export interface SpinnerProps {
  label?: string;
  className?: string;
}

export function Spinner({ label = 'Cargando', className }: SpinnerProps): ReactNode {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cx(
          'inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand',
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-[#0b1220] hover:bg-brand/85 disabled:hover:bg-brand',
  secondary: 'border border-line bg-surface-3 text-ink hover:bg-[#1f262f]',
  ghost: 'text-muted hover:bg-surface-3 hover:text-ink',
  danger: 'border border-danger/50 bg-danger/10 text-danger hover:bg-danger/20',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  /** Texto del spinner (leido por lectores de pantalla). */
  loadingLabel?: string;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  loading = false,
  loadingLabel = 'Procesando',
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        BUTTON_VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner label={loadingLabel} className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// EmptyState
// -----------------------------------------------------------------------------

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps): ReactNode {
  return (
    // 4.1.3: "no hay datos" es un cambio de estado que hay que anunciar, no un
    // hueco silencioso. `role="status"` lo hace sin interrumpir.
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface-2 px-6 py-10 text-center"
    >
      {icon !== undefined && (
        <div aria-hidden="true" className="text-2xl">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description !== undefined && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ErrorCard
// -----------------------------------------------------------------------------

export interface ErrorCardProps {
  title?: string;
  category?: string | null;
  message: string;
  onRetry?: (() => void) | undefined;
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
}

export function ErrorCard({
  title = 'Ocurrió un error',
  category,
  message,
  onRetry,
  retryLabel = 'Reintentar',
  retrying = false,
  className,
}: ErrorCardProps): ReactNode {
  return (
    <div
      role="alert"
      className={cx(
        'rounded-2xl border border-danger/40 bg-danger/10 p-4 text-left',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-danger">{title}</p>
          {category !== undefined && category !== null && category !== '' && (
            <p className="mt-1 font-mono text-xs text-danger/80">{category}</p>
          )}
          <p className="mt-1 text-sm text-ink">{message}</p>
        </div>
        {onRetry !== undefined && (
          <Button variant="danger" onClick={onRetry} loading={retrying}>
            {retryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers de texto
// -----------------------------------------------------------------------------

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }): ReactNode {
  return (
    <h3 id={id} className="text-sm font-semibold uppercase tracking-wide text-muted">
      {children}
    </h3>
  );
}

/** Fila etiqueta/valor usada en el panel de resultado. */
export function DataRow({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line/70 py-2 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted sm:w-48 sm:shrink-0">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

/** Chip pequeño para ids de evidencia. */
export function Chip({ children, title }: { children: ReactNode; title?: string }): ReactNode {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-muted"
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

// -----------------------------------------------------------------------------
// Skeleton
// -----------------------------------------------------------------------------

/**
 * Bloque de carga. Es decorativo: el estado de carga se anuncia con texto en
 * el contenedor que lo envuelve, no con el propio placeholder.
 */
export interface SkeletonProps {
  className?: string;
  /** Alto en px. Se pasa por `style` porque el valor es dinámico. */
  height?: number;
}

export function Skeleton({ className, height }: SkeletonProps): ReactNode {
  return (
    <div
      aria-hidden="true"
      style={height === undefined ? undefined : { height }}
      className={cx('w-full animate-pulse rounded-xl bg-surface-3', className)}
    />
  );
}

// -----------------------------------------------------------------------------
// StatCard
// -----------------------------------------------------------------------------

/**
 * Cifra destacada con etiqueta y pista secundaria. `tone` afecta SOLO al icono:
 * la cifra usa siempre `text-ink` para no depender del color para leerse.
 */
export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /**
   * `true` mientras `value` es un esqueleto. Activa `aria-busy` y un texto
   * "cargando" para que la tarjeta no sea un hueco mudo (WCAG 4.1.3). Por
   * defecto se deduce: si `value` es un `Skeleton`, está cargando.
   */
  isLoading?: boolean;
  className?: string;
}

const TONE_ICON: Record<Tone, string> = {
  neutral: 'text-subtle',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  isLoading = false,
  className,
}: StatCardProps): ReactNode {
  return (
    <div className={cx('rounded-xl border border-line bg-surface-1 p-4', className)}>
      {icon !== undefined && (
        <div aria-hidden="true" className={cx('flex justify-end', TONE_ICON[tone])}>
          {icon}
        </div>
      )}
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {/* `div` y no `p`: `value` acepta cualquier ReactNode y puede ser un
          <Skeleton> (`div`), que no es válido dentro de un párrafo. */}
      {/* 4.1.3: mientras `value` es el `Skeleton` (que es `aria-hidden`), la
          tarjeta solo exponía la etiqueta. Este texto anuncia que el valor
          está en camino. */}
      <div
        aria-busy={isLoading}
        className="mt-1 text-2xl font-bold text-ink"
      >
        {isLoading ? <span className="sr-only">{`Cargando ${label.toLowerCase()}…`}</span> : null}
        {value}
      </div>
      {hint !== undefined && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// ChartFrame
// -----------------------------------------------------------------------------

/**
 * Carcasa aislada de cada gráfica. Concentra los estados (error, carga, vacío)
 * para que una gráfica sin datos o con fallo NUNCA rompa el resto de la página.
 *
 * El alto del área de contenido se aplica con `style` porque el valor viene de
 * la prop `height` en tiempo de ejecución: no existe una clase de Tailwind que
 * pueda resolver una altura arbitraria sin generar utilities dinámicas.
 */
export interface ChartFrameProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  error?: string | null;
  onRetry?: () => void;
  /** Alto en px del área de contenido. */
  height?: number;
  children: ReactNode;
}

export function ChartFrame({
  title,
  description,
  actions,
  isLoading = false,
  isEmpty = false,
  emptyTitle = 'No hay datos para mostrar.',
  emptyDescription,
  error,
  onRetry,
  height = 260,
  children,
}: ChartFrameProps): ReactNode {
  // Prioridad: el error manda sobre el resto de estados. Si la petición falló
  // no se puede afirmar que esté cargando ni que esté vacía.
  const showError = error !== undefined && error !== null && error !== '';

  let body: ReactNode;
  if (showError) {
    body = <ErrorCard message={error} onRetry={onRetry} />;
  } else if (isLoading) {
    // 4.1.3 Status Messages: el `Skeleton` es `aria-hidden`, así que sin este
    // texto la región quedaría muda al cambiar un filtro y el usuario de lector
    // de pantalla no sabría que hay algo cargando. Se anuncia con `role="status"`
    // (político, no agresivo: recargar un filtro no requiere interrumpir).
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">{`Cargando ${title.toLowerCase()}…`}</span>
        <Skeleton height={height} />
      </div>
    );
  } else if (isEmpty) {
    body = <EmptyState title={emptyTitle} description={emptyDescription} />;
  } else {
    body = <div style={{ height }}>{children}</div>;
  }

  return (
    <Panel title={title} description={description} actions={actions}>
      {body}
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// DataTable
// -----------------------------------------------------------------------------

/**
 * Wrapper semántico para tablas con scroll horizontal. Se encarga del
 * `<caption>` oculto y del `min-width` que dispara el scroll en móvil.
 *
 * Clases recomendadas para quien la use (no se imponen aquí):
 *   `<thead>` -> sin clases
 *   `<th>`    -> `border-b border-line px-3 py-2 text-left text-xs font-medium
 *                uppercase tracking-wide text-muted`
 *   `<td>`    -> `border-b border-line/70 px-3 py-2.5 text-ink`
 */
export interface DataTableProps {
  caption: string;
  children: ReactNode;
  className?: string;
}

export function DataTable({ caption, children, className }: DataTableProps): ReactNode {
  return (
    // 2.1.1 Keyboard: en pantallas estrechas esta región scrollea en horizontal.
    // Sin `tabIndex` no se puede enfocar, así que un usuario de teclado no
    // podría desplazar la tabla para ver las columnas de la derecha. `role` +
    // `aria-label` la convierten en región navegable y anunciada.
    <div
    className={cx('-mx-1 contain-paint overflow-x-auto', className)}
    tabIndex={0}
    role="region"
    aria-label={caption}
  >
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
