// =============================================================================
// Render de PDF a <canvas> con pdf.js.
//
// POR QUÉ UN COMPONENTE APARTE Y CARGADO TARDE
//   `pdfjs-dist` pesa del orden de 350 KB con su worker. La evidencia es la
//   excepción, no el caso normal: casi ningún caso tiene un PDF. Importarlo de
//   forma estática lo pagaría toda visita al detalle de un caso, así que el
//   módulo se carga con `import()` únicamente cuando hay un PDF que ver.
//
// POR QUÉ UN <iframe> NO SERVIRÍA
//   El endpoint de evidencia sirve los bytes con `X-Frame-Options: DENY` y
//   `frame-ancestors 'none'` (ver `sendBinary` en `src/server/http.ts`). Un
//   iframe del visor nativo del navegador queda bloqueado por diseño. Renderizar
//   a canvas evita depender de esas cabeceras y no obliga a relajarlas.
//
// SEGURIDAD — ESTO ES CONTENIDO NO CONFIABLE
//   Un PDF subido por un usuario es entrada no confiable: el parser corre en el
//   navegador del operador y los parsadores de PDF han tenido CVEs de escape de
//   sandbox. Lo que este componente hace para acotarlo:
//     · `isEvalSupported: false` — pdf.js no ejecuta el JavaScript embebido en
//       el PDF ni lo compila con `new Function`, aunque el PDF lo pida.
//     · Todo se pinta en un <canvas>; nunca se inyecta HTML del documento.
//     · El texto se dibuja con `canvas.fillText`, no como nodos del DOM.
//   Lo que NO hace: aislar el parser en un proceso aparte. Eso exigiría un
//   worker dedicado por documento o render server-side a imagen, un cambio mayor.
//   `scripts/` y `AGENTS.md` tratan la evidencia como entrada no confiable; este
//   límite es deliberado y está anotado como riesgo abierto.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

// Subconjunto de la API de pdf.js que usamos. Declarado local para no atar el
// componente a la versión interna del paquete.
interface PdfPageProxy {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; document: PdfDocumentProxy }
  | { kind: 'error'; message: string };

const INITIAL_SCALE = 1.4;

export interface PdfCanvasProps {
  /** Mismo origen, con la cookie de sesión: devuelve los bytes con MIME `application/pdf`. */
  url: string;
  /** Nombre legible, para los lectores de pantalla y el error. */
  filename: string;
}

export function PdfCanvas({ url, filename }: PdfCanvasProps): ReactNode {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(INITIAL_SCALE);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Carga el documento una sola vez por `url`. ElAbortController evita que un
  // clic rápido en otra evidencia deje pintar la anterior.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let loaded: PdfDocumentProxy | null = null;

    setState({ kind: 'loading' });
    setPage(1);

    void (async () => {
      try {
        const [pdfjs, workerUrl] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`El servidor respondió ${response.status} al pedir el archivo.`);
        }
        // pdf.js transfiere los buffers al worker: no lo retenemos.
        const buffer = await response.arrayBuffer();
        const task = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          isEvalSupported: false,
        });
        loaded = await task.promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        setState({ kind: 'ready', document: loaded });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el documento.';
        setState({ kind: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      void loaded?.destroy();
    };
  }, [url]);

  const totalPages = state.kind === 'ready' ? state.document.numPages : 0;

  const renderPage = useCallback(async (): Promise<void> => {
    if (state.kind !== 'ready') return;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const pdfPage = await state.document.getPage(page);
    const ratio = window.devicePixelRatio || 1;

    // Tamaño en píxeles de pantalla (CSS) y en píxeles reales del canvas.
    const cssViewport = pdfPage.getViewport({ scale });
    const pixelViewport = pdfPage.getViewport({ scale: scale * ratio });

    const context = canvas.getContext('2d');
    if (context === null) return;

    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;
    canvas.width = Math.floor(pixelViewport.width);
    canvas.height = Math.floor(pixelViewport.height);

    await pdfPage.render({ canvasContext: context, viewport: pixelViewport }).promise;
  }, [state, page, scale]);

  useEffect(() => {
    // Un render por página y escala. Si el componente se desmonta a mitad, el
    // render pendiente ya no pinta sobre el canvas desmontado.
    void renderPage();
  }, [renderPage]);

  if (state.kind === 'error') {
    return (
      <div className="case-workspace-empty">
        <strong>No se pudo mostrar el PDF</strong>
        <p>{state.message}</p>
        <span>Podés descargarlo y abrirlo en otro programa.</span>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className="case-workspace-empty">
        <Loader2 size={22} aria-hidden="true" />
        <strong>Preparando {filename}</strong>
        <p>Cargando el visor de PDF…</p>
      </div>
    );
  }

  return (
    <div className="evidence-pdf">
      <div className="evidence-pdf-toolbar">
        <div className="evidence-pdf-pages" role="group" aria-label="Navegación entre páginas del PDF">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Página anterior"
            className="rounded-lg border border-line bg-surface-3 p-1.5 text-ink transition-colors hover:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span aria-live="polite">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Página siguiente"
            className="rounded-lg border border-line bg-surface-3 p-1.5 text-ink transition-colors hover:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="evidence-pdf-zoom" role="group" aria-label="Tamaño del PDF">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.2).toFixed(2))))}
            disabled={scale <= 0.5}
            className="rounded-lg border border-line bg-surface-3 px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            −
            <span className="sr-only"> Reducir el tamaño del PDF</span>
          </button>
          <span className="text-xs tabular-nums text-muted">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, Number((s + 0.2).toFixed(2))))}
            disabled={scale >= 3}
            className="rounded-lg border border-line bg-surface-3 px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-[#1f262f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
            <span className="sr-only"> Aumentar el tamaño del PDF</span>
          </button>
        </div>
      </div>

      <div className="evidence-pdf-scroll">
        {/* El PDF nunca inyecta nodos: solo píxeles. */}
        <canvas ref={canvasRef} role="img" aria-label={`Página ${page} de ${totalPages} de ${filename}`} />
      </div>
    </div>
  );
}