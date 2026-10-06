import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CHANNELS,
  EVIDENCE_COUNTRIES,
} from '../src/skills/audit/types';
import {
  CHANNEL_LABELS,
  COUNTRY_LABELS,
  originLabel,
  UNDETERMINED_LABEL,
} from '../src/lib/labels';

describe('vocabulario de origen', () => {
  it('tiene los 11 países y los 7 canales exactos', () => {
    expect([...EVIDENCE_COUNTRIES]).toEqual(['MX', 'CO', 'AR', 'CL', 'PE', 'BR', 'EC', 'PA', 'PR', 'DO', 'GT']);
    expect([...EVIDENCE_CHANNELS]).toEqual(['WHATSAPP', 'CRM', 'I6', 'SIU', 'FLOKZU', 'EMAIL', 'CALL']);
  });

  it('tiene etiqueta en español para cada valor del catálogo', () => {
    for (const country of EVIDENCE_COUNTRIES) expect(COUNTRY_LABELS[country]).toBeTruthy();
    for (const channel of EVIDENCE_CHANNELS) expect(CHANNEL_LABELS[channel]).toBeTruthy();
  });

  it('etiquetas en español exactas', () => {
    expect(COUNTRY_LABELS.MX).toBe('México');
    expect(COUNTRY_LABELS.DO).toBe('República Dominicana');
    expect(CHANNEL_LABELS.WHATSAPP).toBe('WhatsApp');
    expect(CHANNEL_LABELS.EMAIL).toBe('Correo electrónico');
    expect(CHANNEL_LABELS.CALL).toBe('Llamada');
  });

  it('un valor null se muestra como Sin determinar, nunca vacío', () => {
    expect(originLabel('country', null)).toBe(UNDETERMINED_LABEL);
    expect(originLabel('channel', null)).toBe(UNDETERMINED_LABEL);
  });

  it('un valor fuera de catálogo cae al valor crudo en vez de romperse', () => {
    expect(originLabel('country', 'ZZ')).toBe('ZZ');
  });
});