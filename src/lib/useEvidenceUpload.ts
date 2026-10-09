// =============================================================================
// Motor de subida de evidencias: secuencial, con estado y error POR ARCHIVO.
//
// Se extrae de `EvidenceUploader` (que sigue siendo su único consumidor visual)
// para que el ALTA de caso reutilice exactamente la misma lógica en vez de
// copiarla: una sola implementación de la secuencia, del mensaje de progreso y
// del aislamiento de errores por archivo.
//
// DECISIÓN DE ARQUITECTURA
//   El `caseId` viaja como argumento de `runUploads` porque en el alta se conoce
//   justo después de `createCase`, dentro de la misma pulsación. No es una puerta
//   a un caso ajeno: el alcance y la propiedad los resuelve el servidor (404).
// =============================================================================

import { useCallback, useRef, useState } from 'react';
import { toErrorState, uploadEvidence } from './api';
import { readEvidenceHead, resolveEvidenceMime } from '../shared/evidence-formats.js';
import { EVIDENCE_TYPE_REJECTED_MESSAGE, isAcceptedEvidenceMime } from './labels';

export type UploadStatus = 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  /** El archivo real, para poder reconciliar la fila al reintentar. */
  file: File;
  name: string;
  sizeBytes: number;
  status: UploadStatus;
  message?: string;
  category?: string;
}

export interface UploadFailure {
  file: File;
  /** Mensaje y categoría tal como los devolvió el servidor. */
  message: string;
  category: string;
}

export interface UploadOutcome {
  /** Cuántos archivos del lote subieron con éxito. */
  uploaded: number;
  /**
   * Los que NO subieron, con su error. Es el único lote reintentable y la
   * fuente exacta para pintar el estado por archivo.
   */
  failed: UploadFailure[];
  /** Nombres de los fallidos, para el mensaje agregado. */
  failedNames: string[];
}

export interface EvidenceUploadController {
  items: UploadItem[];
  busy: boolean;
  announcement: string;
  /**
   * Sube un lote de forma SECUENCIAL. Nunca lanza: el fallo de un archivo no
   * cancela el resto y queda registrado en su propia fila.
   *
   * El `caseId` es un ARGUMENTO y no el del hook a propósito: en el alta se
   * conoce justo después de `createCase`, dentro de la misma pulsación. Cerrar
   * el identificador aquí capturaría el `null` previo al alta y no subiría nada.
   */
  runUploads: (caseId: string, files: File[]) => Promise<UploadOutcome>;
  /**
   * Quita del panel las filas YA TERMINADAS.
   *
   * Conserva las que siguen `uploading` (su progreso se perdería de la vista)
   * y descarta las que están en `done` o `error` (su resultado ya está en la
   * región `aria-live`). Para dejar el panel en cero hay que esperar a que no
   * haya nada en curso.
   */
  clearFinished: () => void;
}

/**
 * Identidad de un ARCHIVO dentro del panel: mismo nombre y mismo tamaño.
 *
 * Asume que una sola selección no trae dos archivos distintos con nombre y
 * tamaño idénticos. Es una suposición pragmática, no criptográfica: el
 * propósito es reconciliar un reintento con su fila, no autenticar contenido.
 */
export function uploadItemKey(name: string, sizeBytes: number): string {
  return `${name}:${sizeBytes}`;
}

export function useEvidenceUpload(): EvidenceUploadController {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const sequence = useRef(0);

  /** Identificador único por intento, no por archivo: la fila se reconcilia. */
  const nextItemId = useCallback((): string => {
    sequence.current += 1;
    return `up-${sequence.current}`;
  }, []);

  const patch = useCallback((id: string, changes: Partial<UploadItem>): void => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const clearFinished = useCallback((): void => {
    setItems((prev) => prev.filter((item) => item.status === 'uploading'));
  }, []);

  const runUploads = useCallback(
    async (caseId: string, files: File[]): Promise<UploadOutcome> => {
      const failed: UploadFailure[] = [];
      if (files.length === 0) {
        return { uploaded: 0, failed, failedNames: [] };
      }

      // Reconciliación: si el archivo ya tiene fila, esa fila se SUSTITUYE por la
      // nueva en lugar de anteponerse. Sin esto un reintento duplicaría la fila
      // del mismo archivo (dos filas por nombre).
      const queued: UploadItem[] = files.map((file) => ({
        id: nextItemId(),
        file,
        name: file.name,
        sizeBytes: file.size,
        status: 'uploading',
        // Un reintento no hereda el fallo anterior: se evalúa desde cero.
        message: undefined,
        category: undefined,
      }));
      setItems((prev) => {
        const keyOf = (item: UploadItem): string => uploadItemKey(item.name, item.sizeBytes);
        const pending = new Set(queued.map(keyOf));
        const kept = prev.filter((item) => !pending.has(keyOf(item)));
        // Las filas nuevas van primero; las que no son del lote conservan su
        // posición relativa, como antes.
        return [...queued, ...kept];
      });
      setBusy(true);
      setAnnouncement(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}…`);

      let uploaded = 0;
      try {
        // Secuencial: evita ráfagas de subidas grandes y da progreso legible.
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index];
          const item = queued[index];
          if (file === undefined || item === undefined) continue;

          try {
            // Validación previa: resolvemos el MIME efectivo (firma real vs
            // declarado, con la declaración decidiendo en firmas ambiguas). Si
            // queda fuera de la allowlist, rechazamos localmente para no gastar
            // una petición que terminaría en 400/415.
            const head = await readEvidenceHead(file);
            const acceptedMime = resolveEvidenceMime(head, file.type);
            if (!isAcceptedEvidenceMime(acceptedMime)) {
              const state = { category: 'UPLOAD_ERROR', message: EVIDENCE_TYPE_REJECTED_MESSAGE };
              patch(item.id, { status: 'error', message: state.message, category: state.category });
              failed.push({ file, message: state.message, category: state.category });
              continue;
            }

            await uploadEvidence(caseId, file);
            patch(item.id, { status: 'done' });
            uploaded += 1;
          } catch (cause) {
            const state = toErrorState(cause);
            patch(item.id, { status: 'error', message: state.message, category: state.category });
            failed.push({ file, message: state.message, category: state.category });
          }
        }
      } finally {
        setBusy(false);
        const failedNames = failed.map((failure) => failure.file.name);
        const parts = [`${uploaded} de ${files.length} archivo(s) subidos.`];
        if (failedNames.length > 0) parts.push(`Fallaron: ${failedNames.join(', ')}.`);
        setAnnouncement(parts.join(' '));
      }

      return { uploaded, failed, failedNames: failed.map((failure) => failure.file.name) };
    },
    [nextItemId, patch],
  );

  return { items, busy, announcement, runUploads, clearFinished };
}
