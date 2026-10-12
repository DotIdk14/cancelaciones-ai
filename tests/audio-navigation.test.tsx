// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EvidencePane } from '../src/components/EvidencePane';
import { referencedSeconds, EvidenceReferences } from '../src/components/EvidenceReferences';
import type { Evidence } from '../src/lib/api';
const audio: Evidence = { id: 'audio-1', caseId: 'case-1', filename: 'Llamada.mp3', mimeType: 'audio/mpeg', sizeBytes: 100, hash: 'hash', storagePath: 'original', processingStatus: 'READY', processingError: null, createdAt: '2026-10-12T00:00:00Z', transcript: { transcript: 'Fragmento sintético', durationSeconds: 120, speakers: [{ speaker: 'A', start: 65250, end: 68000, text: 'Fragmento sintético', confidence: 1 }] } };
afterEach(cleanup);
describe('navegación temporal de evidencias', () => {
  it('espera metadata y convierte milisegundos a segundos exactos', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const { container, getByRole } = render(<EvidencePane evidence={audio} />);
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'readyState', { value: 0, configurable: true });
    fireEvent.click(getByRole('button', { name: /fragmento sintético/i }));
    expect(player.currentTime).toBe(0);
    Object.defineProperty(player, 'readyState', { value: 1 });
    Object.defineProperty(player, 'duration', { value: 120 });
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(65.25);
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.src).toContain('preview=1');
  });
  it('aplica referencias externas y reinicia el reproductor al cambiar de archivo', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const { container, rerender } = render(<EvidencePane evidence={audio} seekRequest={{ seconds: 82, requestId: 1 }} />);
    const player = container.querySelector('audio')!;
    Object.defineProperty(player, 'readyState', { value: 1 });
    Object.defineProperty(player, 'duration', { value: 120 });
    fireEvent.loadedMetadata(player);
    expect(player.currentTime).toBe(82);
    rerender(<EvidencePane evidence={{ ...audio, id: 'audio-2' }} />);
    expect(container.querySelector('audio')).not.toBe(player);
    expect(container.querySelector('audio')!.currentTime).toBe(0);
  });
  it('identifica tiempos explícitos y evita asignarlos a una llamada ambigua', () => {
    expect(referencedSeconds('00:15, 01:05 y 01:02:03; inválido 1:90')).toEqual([{ label: '00:15', seconds: 15 }, { label: '01:05', seconds: 65 }, { label: '01:02:03', seconds: 3723 }]);
    const open = vi.fn();
    const { getByRole, rerender, queryByRole } = render(<EvidenceReferences text="Cita en 01:05" evidenceIds={[audio.id]} evidences={[audio]} onOpen={open} />);
    fireEvent.click(getByRole('button', { name: 'Escuchar 01:05' }));
    expect(open).toHaveBeenCalledWith(audio.id, 65);
    rerender(<EvidenceReferences text="Cita en 01:05" evidenceIds={[audio.id, 'audio-2']} evidences={[audio, { ...audio, id: 'audio-2' }]} onOpen={open} />);
    expect(queryByRole('button', { name: 'Escuchar 01:05' })).toBeNull();
  });
});
