// =============================================================================
// Visor de evidencia dentro de la columna central del detalle de caso.
//
// Sustituye al modal `EvidenceViewer`: la evidencia se lee en el mismo sitio
// donde ya vive el expediente, sin capas superpuestas ni otro `role="dialog"`
// que_War el foco.
//
// El alcance se resuelve server-side (evidenceId → caso → identidad), y la URL
// es relativa, así que la cookie de sesión viaja sola en cada petición.
// =============================================================================

import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { Evidence } from '../lib/api';
import { evidenceDownloadUrl, evidencePreviewUrl } from '../lib/api';
import { formatBytes, formatDuration, textOrDash } from '../lib/format';
import {
  EVIDENCE_KIND_LABELS,
  evidenceAltText,
  isAudioMime,
  isImageMime,
  isPdfMime,
  kindFromMime,
} from '../lib/labels';
import { PdfCanvas } from './PdfCanvas';
import { Spinner } from './ui';

export interface EvidencePaneProps {
  evidence: Evidence;
  studentName?: string | null;
}

export function EvidencePane({ evidence, studentName }: EvidencePaneProps): ReactNode {
  const kind = kindFromMime(evidence.mimeType);
  const downloadUrl = evidenceDownloadUrl(evidence.id);
  const previewUrl = evidencePreviewUrl(evidence.id);
  const [imageScale, setImageScale] = useState(1);

  useEffect(() => setImageScale(1), [evidence.id]);

  return (
    <div className="evidence-pane" aria-label={studentName ? `Evidencia de ${studentName}` : undefined}>
      <header className="evidence-pane-header">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{evidence.filename}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {EVIDENCE_KIND_LABELS[kind]} · {formatBytes(evidence.sizeBytes)} · {evidence.mimeType || '—'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a
            href={downloadUrl}
            download
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-strong)]"
          >
            Descargar<span className="sr-only"> {evidence.filename}</span>
          </a>
        </div>
      </header>

      <div className="evidence-pane-body">
        {isImageMime(evidence.mimeType) && (
          <div className="evidence-image-viewer">
            <div className="evidence-image-toolbar" role="group" aria-label="Zoom de la imagen">
              <button type="button" onClick={() => setImageScale((scale) => Math.max(0.5, Number((scale - 0.25).toFixed(2))))} disabled={imageScale <= 0.5} aria-label="Reducir imagen"><Minus size={15} /></button>
              <span>{Math.round(imageScale * 100)}%</span>
              <button type="button" onClick={() => setImageScale((scale) => Math.min(4, Number((scale + 0.25).toFixed(2))))} disabled={imageScale >= 4} aria-label="Agrandar imagen"><Plus size={15} /></button>
              <button type="button" onClick={() => setImageScale(1)} disabled={imageScale === 1} aria-label="Ajustar imagen al panel"><RotateCcw size={14} /> Ajustar</button>
            </div>
            <div className="evidence-image-scroll">
              <img
                src={previewUrl}
                alt={evidenceAltText(evidence.filename, evidence.mimeType)}
                className="evidence-pane-image"
                style={{ width: `${imageScale * 100}%` }}
              />
            </div>
          </div>
        )}

        {isAudioMime(evidence.mimeType) && (
          <div className="flex flex-col gap-4">
            {evidence.transcript !== null ? (
              <AudioTranscript evidence={evidence} studentName={studentName ?? null} audioUrl={downloadUrl} />
            ) : (
              <>
                <audio controls src={downloadUrl} className="evidence-audio-player">
                  Tu navegador no puede reproducir este audio. Usa el botón Descargar.
                </audio>
                <p className="text-sm text-muted">Este audio todavía no tiene transcripción. Cuando termine de procesarse, aparecerá aquí.</p>
              </>
            )}
          </div>
        )}

        {isPdfMime(evidence.mimeType) && <PdfCanvas url={previewUrl} filename={evidence.filename} />}

        {kind === 'TEXT' && (
          <TextPreview url={previewUrl} />
        )}

        {/* Rama de seguridad ante un kind nuevo. Hoy es código inalcanzable:
            `kindFromMime` cae siempre a 'TEXT', y `verifyFileSignature` ya
            limita lo que se puede subir a la allowlist de MIME. Se mantiene
            para que añadir un kind no deje el panel en blanco. */}
        {!isImageMime(evidence.mimeType) &&
          !isAudioMime(evidence.mimeType) &&
          !isPdfMime(evidence.mimeType) &&
          kind !== 'TEXT' && (
            <p className="text-sm text-muted">
              Este tipo de archivo no tiene vista previa. Podés abrirlo o descargarlo para revisarlo.
            </p>
          )}
      </div>
    </div>
  );
}

function extractGreetingName(text: string): string | null {
  const match = text.match(/\b(?:soy|me llamo|mi nombre es|le habla|habla)\s+([^,.!?;]{2,64})/i);
  if (match === null) return null;
  const excluded = /\b(?:asesor(?:a)?|estudiante|alumno|alumna|cliente|de|utel|soporte|servicio|y|seré|soy|la|el|un|una|su|le)\b/i;
  const captured = match[1];
  if (captured === undefined) return null;
  const candidate = captured.split(/\s+/).filter((word) => !excluded.test(word)).slice(0, 3).join(' ').trim();
  return candidate.length > 1 ? candidate.replace(/\s+/g, ' ') : null;
}

function AudioTranscript({ evidence, studentName, audioUrl }: { evidence: Evidence; studentName: string | null; audioUrl: string }): ReactNode {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const speakers = evidence.transcript?.speakers ?? [];
  const speakerLabels = useMemo(() => {
    const profiles = new Map<string, { name: string | null; role: string | null }>();
    const normalizedStudent = studentName?.trim().toLocaleLowerCase('es-MX') ?? '';
    const studentNameTokens = normalizedStudent.split(/\s+/).filter((token) => token.length >= 3);
    for (const segment of speakers.slice(0, 8)) {
      const text = segment.text;
      const current = profiles.get(segment.speaker) ?? { name: null, role: null };
      const normalizedText = text.toLocaleLowerCase('es-MX');
      const mentionsStudent = normalizedStudent !== '' && (
        normalizedText.includes(normalizedStudent) || studentNameTokens.some((token) => normalizedText.includes(token))
      );
      const saysAdvisor = /\basesor(?:a)?\b|\bte atiende\b|\ble atiende\b|\ble habla\b.*\butel\b/i.test(text);
      const saysClient = /\bsoy (?:el|la )?(?:estudiante|alumno|alumna|cliente)\b|\bhablo como estudiante\b/i.test(text);
      const greetingName = extractGreetingName(text);
      profiles.set(segment.speaker, {
        name: current.name ?? (mentionsStudent ? studentName : greetingName),
        role: current.role ?? (saysAdvisor ? 'Asesor' : saysClient || mentionsStudent ? 'Cliente' : null),
      });
    }
    const uniqueSpeakers = [...new Set(speakers.map((segment) => segment.speaker))];
    const identifiedClient = [...profiles].find(([, profile]) => profile.role === 'Cliente')?.[0];
    if (uniqueSpeakers.length === 2 && identifiedClient !== undefined) {
      const otherSpeaker = uniqueSpeakers.find((speaker) => speaker !== identifiedClient);
      if (otherSpeaker !== undefined) {
        const profile = profiles.get(otherSpeaker) ?? { name: null, role: null };
        if (profile.role === null) profiles.set(otherSpeaker, { ...profile, role: 'Asesor' });
      }
    }
    return profiles;
  }, [speakers, studentName]);

  const activeIndex = speakers.findIndex((segment, index) =>
    currentTime * 1000 >= segment.start && (index === speakers.length - 1 || currentTime * 1000 < speakers[index + 1]!.start),
  );

  function seekTo(startMs: number): void {
    const audio = audioRef.current;
    if (audio === null) return;
    audio.currentTime = Math.max(0, startMs / 1000);
    void audio.play().catch(() => undefined);
  }

  const uniqueSpeakers = [...new Set(speakers.map((segment) => segment.speaker))];

  return (
    <section className="audio-transcript" aria-label={`Audio y transcripción de ${evidence.filename}`}>
      <audio ref={audioRef} controls src={audioUrl} className="evidence-audio-player" onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}>
        Tu navegador no puede reproducir este audio. Usa el botón Descargar.
      </audio>
      <div className="audio-transcript-heading">
        <div><h3>Transcripción</h3><p>{formatDuration(evidence.transcript?.durationSeconds)} · Selecciona un diálogo para escuchar desde ahí</p></div>
        <span>Los nombres se toman de las presentaciones del audio</span>
      </div>
      {speakers.length > 0 ? (
        <ol className="audio-transcript-list">
          {speakers.map((segment, index) => {
            const profile = speakerLabels.get(segment.speaker);
            const speakerIndex = uniqueSpeakers.indexOf(segment.speaker);
            const role = profile?.role ?? `Participante ${String.fromCharCode(65 + Math.max(0, speakerIndex))}`;
            const name = profile?.name;
            return (
              <li key={`${evidence.id}-${index}`}>
                <button type="button" className="audio-transcript-line" aria-current={activeIndex === index ? 'true' : undefined} onClick={() => seekTo(segment.start)}>
                  <span className="audio-transcript-time">{formatDuration(segment.start / 1000)}</span>
                  <span className="audio-transcript-copy">
                    <span className={`audio-transcript-speaker${role === 'Asesor' ? ' is-advisor' : role === 'Cliente' ? ' is-client' : ''}`}>{role}{name ? ` · ${name}` : ''}</span>
                    <span>{segment.text}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="case-transcript-plain">{textOrDash(evidence.transcript?.transcript)}</p>
      )}
    </section>
  );
}

/**
 * Texto plano: se pide por `fetch` en lugar de usar el `extracted_text` del
 * caso. Trae el binario original —que es lo que el operador subió— y evita
 * ampliar el contrato de la API para una vista que el servidor ya puede servir.
 * `Content-Type: text/plain` más `<pre>`: se muestra literal, sin interpretar
 * ninguna etiqueta que el archivo pudiera contener.
 */
function TextPreview({ url }: { url: string }): ReactNode {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setText(null);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`El servidor respondió ${response.status}.`);
        const body = await response.text();
        setText(body.trim() === '' ? '' : body);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo.');
      }
    })();

    return () => controller.abort();
  }, [url]);

  if (error !== null) {
    return (
      <p className="text-sm text-danger">
        No se pudo mostrar el texto: {error} Podés descargarlo para abrirlo.
      </p>
    );
  }

  if (text === null) {
    return <Spinner label="Cargando el contenido del archivo" />;
  }

  if (text === '') {
    return <p className="text-sm text-muted">El archivo está vacío.</p>;
  }

  return (
    <pre className="evidence-pane-text">
      {/* <pre> escapa el contenido: el texto del archivo nunca se interpreta como HTML. */}
      {text}
    </pre>
  );
}
