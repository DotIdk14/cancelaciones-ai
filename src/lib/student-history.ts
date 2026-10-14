import type { studentHistory, studentHistoryEntry } from '../server/student-history';
export type StudentHistory = Awaited<ReturnType<typeof studentHistory>>;
export type StudentHistoryEntry = Awaited<ReturnType<typeof studentHistoryEntry>>;
export async function readStudentHistory<T>(caseId: string, view: 'student-history' | 'student-history-entry', offset = 0, relatedCaseId?: string): Promise<T> {
  const query = new URLSearchParams({ view, offset: String(offset), ...(relatedCaseId ? { relatedCaseId } : {}) });
  const response = await fetch('/api/cases/' + encodeURIComponent(caseId) + '?' + query, { credentials: 'same-origin', headers: { 'X-App-Request': '1' } });
  if (!response.ok) throw new Error('No se pudo consultar el historial. Vuelve a intentarlo.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || (view === 'student-history' && (!('summary' in data) || !('cases' in data)))) throw new Error('El historial no está disponible en este momento. Vuelve a intentarlo.');
  return data as T;
}
