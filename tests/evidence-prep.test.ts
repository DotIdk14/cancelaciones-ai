import { describe, expect, it } from 'vitest';
import {
  detectKind,
  imageDataUrl,
  isAudio,
  normalizeMime,
  readTranscriptFromJson,
  sanitizeFilename,
  sha256Hex,
} from '../src/server/evidence-prep';

describe('evidence-prep (preparación técnica, sin decisión de negocio)', () => {
  it('calcula el SHA-256 para provenance', () => {
    const hash = sha256Hex(Buffer.from('contenido'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(sha256Hex(Buffer.from('contenido')));
  });

  it('sanitiza nombres con rutas y caracteres peligrosos', () => {
    // Traversal: se queda con el basename (segmento final) — nunca conserva `..` ni `/`.
    expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd.png');
    expect(sanitizeFilename('a<b>c:"d|e?f*.png')).toBe('a_b_c__d_e_f_.png');
    expect(sanitizeFilename('  ')).toBe('evidencia');
    expect(sanitizeFilename('nombre con espacios.png')).toBe('nombre_con_espacios.png');
    // El separador de Windows también se neutraliza.
    expect(sanitizeFilename('C:\\Users\\x\\archivo.pdf')).toBe('archivo.pdf');
    // Nunca reintroduce rutas ni caracteres de control.
    const output = sanitizeFilename('..\\..\\inject\\evil.sh');
    expect(output).not.toContain('..');
    expect(output).not.toContain('\\');
    expect(output).not.toContain('/');
  });

  it('normaliza MIME y rechaza tipos no soportados', () => {
    expect(normalizeMime('IMAGE/PNG')).toBe('image/png'); // case-insensitive
    expect(normalizeMime('application/pdf')).toBe('application/pdf');
    expect(normalizeMime('audio/mpeg; charset=binary')).toBe('audio/mpeg');
    expect(normalizeMime('audio/mp4')).toBe('audio/mp4');
    expect(normalizeMime('audio/wav')).toBe('audio/wav');
    expect(normalizeMime('audio/webm')).toBe('audio/webm');
    expect(normalizeMime('audio/ogg')).toBe('audio/ogg');
    expect(normalizeMime('audio/x-m4a')).toBe('audio/x-m4a');
    expect(normalizeMime('audio/m4a')).toBe('audio/m4a');
    expect(normalizeMime('audio/x-evil')).toBeNull();
    expect(normalizeMime('audio/unknown')).toBeNull();
    expect(normalizeMime('application/x-msdownload')).toBeNull(); // .exe rechazado
    expect(normalizeMime('text/html')).toBeNull(); // html no está en la allowlist
    expect(normalizeMime('')).toBeNull();
  });

  it('detecta el tipo de evidencia por MIME', () => {
    expect(detectKind('image/jpeg')).toBe('IMAGE');
    expect(detectKind('application/pdf')).toBe('PDF');
    expect(detectKind('audio/mp4')).toBe('AUDIO');
    expect(detectKind('text/plain')).toBe('TEXT');
    expect(isAudio('audio/mpeg')).toBe(true);
    expect(isAudio('application/pdf')).toBe(false);
  });

  it('construye data URIs de imagen para el modelo multimodal', () => {
    expect(imageDataUrl(Buffer.from('AA==', 'base64'), 'image/png')).toBe('data:image/png;base64,AA==');
  });

  it('lee la transcripción normalizada desde transcript_json', () => {
    const transcript = readTranscriptFromJson({
      assemblyId: 'aa-1',
      status: 'READY',
      transcript: {
        transcript: 'Hola',
        durationSeconds: 3,
        speakers: [
          { speaker: 'A', start: 0, end: 1500, text: 'Hola', confidence: 0.9 },
          { speaker: 'B', start: 1500, end: 3000, text: 'Adiós', confidence: 0.8 },
        ],
      },
    });
    expect(transcript?.transcript).toBe('Hola');
    expect(transcript?.speakers).toHaveLength(2);
    expect(transcript?.speakers[0]?.speaker).toBe('A');
    expect(transcript?.speakers[1]?.text).toBe('Adiós');
  });

  it('devuelve null si transcript_json no tiene transcripción', () => {
    expect(readTranscriptFromJson(null)).toBeNull();
    expect(readTranscriptFromJson({ assemblyId: 'aa-1', status: 'TRANSCRIBING' })).toBeNull();
  });
});
