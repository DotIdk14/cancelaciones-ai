import { VISION_TIMEOUT_MS } from '@cancelaciones/shared';
import type { EvidenceRecord, VisionProvider } from './ports';

export interface ImageDescription {
  text: string;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Prompt de descripción de imagen.
 *
 * Esto NO es un serializador de reglas. El contenido normativo no entra por aquí:
 * las listas de campos, los `factType` y los requisitos de completitud son
 * criterios del motor, y meterlos en el prompt obligaría al modelo a *buscar* lo
 * que la norma exige en lugar de *leer* lo que el documento dice. Aquí solo se le
 * pide transcribir.
 *
 * Si alguna vez hace falta orientar al modelo, la orientación va en el texto que
 * rodea a la evidencia, no en el prompt de visión.
 */
export const IMAGE_DESCRIPTION_PROMPT = [
  'Describe este documento.',
  'Transcribe literalmente todo el texto visible, conservando el orden de lectura.',
  'No interpretes, no concluyas, no resumas.',
  'Si el documento tiene sellos, firmas o anotaciones manuscritas, descríbelos.',
  'Si hay tablas, transcribe las celdas separadas por ` | `.',
].join(' ');

export interface ImageVisionRequest {
  base64: string;
  mimeType: string;
}

/**
 * Arma la petición de visión. El base64 se calcula aquí y no en el cliente HTTP:
 * el mismo formato tiene que servir para el transporte, para el log de coste y
 * para el test, y duplicar la codificación es la forma más corta de que diverjan.
 *
 * El mime sale de `detectedMimeType`, que viene de los **bytes** (firma verificada
 * en la subida), no del nombre de archivo ni del mime declarado por el cliente.
 */
export function buildImageVisionRequest(evidence: EvidenceRecord, bytes: Uint8Array): ImageVisionRequest {
  return { base64: Buffer.from(bytes).toString('base64'), mimeType: evidence.detectedMimeType };
}

export interface DescribeEvidenceImageInput {
  evidence: EvidenceRecord;
  bytes: Uint8Array;
  provider: VisionProvider;
  model: string;
  /** Timeout de la llamada. Por defecto el límite compartido de visión. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Pide al proveedor la transcripción literal de una imagen y devuelve el texto más
 * el coste. No persiste nada y no interpreta nada: el texto que sale es exactamente
 * lo que el agente va a leer.
 */
export async function describeEvidenceImage(input: DescribeEvidenceImageInput): Promise<ImageDescription> {
  const request = buildImageVisionRequest(input.evidence, input.bytes);
  const response = await input.provider.describeImage({
    base64: request.base64,
    mimeType: request.mimeType,
    filename: input.evidence.safeFilename,
    prompt: IMAGE_DESCRIPTION_PROMPT,
    timeoutMs: input.timeoutMs ?? VISION_TIMEOUT_MS,
    signal: input.signal,
  });

  return {
    text: response.text,
    provider: input.provider.name ?? 'vision',
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
