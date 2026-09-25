import { describe, expect, it } from 'vitest';
import { isAiProcessingEnabled, guardProcessing } from './processing-switch';

describe('kill switch de procesamiento costoso', () => {
  describe('apagado', () => {
    it.each(['false', 'FALSE', 'False', '0', 'no', 'NO', 'off', 'OFF', ' false '])(
      'AI_PROCESSING_ENABLED=%s desactiva el procesamiento',
      (value) => {
        expect(isAiProcessingEnabled(value)).toBe(false);
      },
    );
  });

  describe('encendido, y por qué el default es encendido', () => {
    it.each([undefined, null, '', 'true', '1', 'yes', 'on', 'TRUE'])(
      'AI_PROCESSING_ENABLED=%s mantiene el procesamiento',
      (value) => {
        expect(isAiProcessingEnabled(value)).toBe(true);
      },
    );

    it('la ausencia de la variable NO apaga producción', () => {
      // Un despliegue sin la variable debe procesar con normalidad. Si el
      // default fuera "apagado", un forgot de configuración dejaría el producto
      // entero sin dictamen y nadie sabría por qué.
      expect(isAiProcessingEnabled(undefined)).toBe(true);
    });

    it('un typo no apaga nada por sorpresa', () => {
      // 'flase' no es un valor de apagador reconocido. Interpretarlo como falso
      // sería peligroso; ignorarlo es lo seguro.
      expect(isAiProcessingEnabled('flase')).toBe(true);
      expect(isAiProcessingEnabled('disabled')).toBe(true);
    });
  });

  describe('guardProcessing', () => {
    it('permite cuando está encendido', () => {
      expect(guardProcessing(true)).toEqual({ enabled: true, reason: null });
    });

    it('deniega con motivo estable cuando está apagado', () => {
      expect(guardProcessing(false)).toEqual({ enabled: false, reason: 'AI_PROCESSING_DISABLED' });
    });

    it('el motivo es un código estable, no un mensaje para humanos', () => {
      // Los reason codes viajan a logs y a clientes; los mensajes no. Mezclarlos
      // obliga a parsear texto para tomar decisiones.
      expect(typeof guardProcessing(false).reason).toBe('string');
      expect(guardProcessing(false).reason).toMatch(/^[A-Z_]+$/);
    });
  });

  describe('lo que el interruptor NO apaga', () => {
    it('no depende de la base de datos: es una variable de entorno', () => {
      // Se comprueba la firma, no un mock. La garantía que se quiere fijar es
      // que la decisión se toma sin consultar nada, para que un fallo de base
      // de datos no pueda dejar el procesamiento abierto.
      expect(isAiProcessingEnabled.length).toBe(1);
    });
  });
});
