import { useEffect, useRef, useState } from 'react';
import { getCase, type CaseDetailResponse } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button } from './ui';

const fields: Array<[string, (d: CaseDetailResponse) => string | null | undefined]> = [
  ['Alumno', d => d.case.studentName],
  ['Programa / nivel / bloque', d => d.case.flokzuData ? [d.case.flokzuData.academic.program, d.case.flokzuData.academic.level, d.case.flokzuData.academic.block].filter(Boolean).join(' · ') : null],
  ['Ingreso de matrícula · Flokzu', d => d.case.flokzuData?.academic.entryDate],
  ['Inicio real de clases · captura humana', d => d.case.cycleStartDate],
  ['Fecha de auditoría consultada', d => d.audit ? formatDateTime(d.audit.createdAt) : null],
  ['Resultado de auditoría consultada', d => d.audit?.resultJson?.audit.result],
  ['Lineamiento / sección V5', d => d.audit?.resultJson ? `${d.audit.resultJson.audit.rule} · ${d.audit.resultJson.audit.procedureSection}` : null],
  ['Justificación original', d => d.audit?.resultJson?.audit.reasoning],
  ['Evidencias de este expediente', d => d.evidences.map(e => e.filename).sort().join('\n')],
  ['Huella de archivos (hash guardado)', d => d.evidences.map(e => `${e.filename}: ${e.hash ?? 'Sin hash disponible'}`).sort().join('\n')],
  ['Vigencia de la auditoría consultada', d => !d.audit ? null : d.auditIsCurrent === false ? 'Histórica; evidencia o contexto cambiaron' : 'Última auditoría consultada'],
  ['Evidencias faltantes declaradas', d => d.audit?.resultJson?.audit.missingEvidence.map(e => `${e.title}: ${e.reason}`).join('\n')],
  ['Hechos registrados', d => d.audit?.resultJson?.facts.map(f => `${f.label}: ${String(f.value ?? 'Sin determinar')} · ${f.evidenceText ?? 'Sin cita guardada'}`).join('\n')],
  ['Contactos y gestiones · cronología guardada', d => d.audit?.resultJson?.timeline.filter(e => /contact|conversa|llamada|gesti[oó]n|[eé]xito estudiantil/i.test(e.event)).map(e => `${e.date ?? 'Sin fecha'}: ${e.event}`).join('\n')],
  ['Eventos del expediente', d => d.audit?.resultJson?.timeline.map(e => `${e.date ?? 'Sin fecha'}: ${e.event}`).join('\n')],
];

export function HistoryComparisonDetails({ tickets }: { tickets: Array<{ id: string; externalCaseId: string | null }> }) {
  const ids = tickets.map(ticket => ticket.id).join(':');
  const cache = useRef(new Map<string, CaseDetailResponse>());
  const [details, setDetails] = useState<CaseDetailResponse[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetails([]); setError('');
    Promise.all(ids.split(':').map(async id => {
      const detail = cache.current.get(id) ?? await getCase(id);
      if (detail.case.id !== id || detail.evidences.some(e => e.caseId !== id) || (detail.audit && detail.audit.caseId !== id)) throw new Error('Identidad incompatible');
      cache.current.set(id, detail); return detail;
    })).then(items => { if (!cancelled) setDetails(items); }).catch(() => { if (!cancelled) setError('No se pudieron consultar los datos de comparación.'); });
    return () => { cancelled = true; };
  }, [ids, retry]);
  if (error) return <p role="alert">{error} <Button onClick={() => setRetry(n => n + 1)}>Reintentar</Button></p>;
  if (details.length !== 2) return <p role="status">Consultando cada expediente por separado…</p>;
  return <><p className="text-muted text-sm">Diferencias entre valores guardados. “Sin registrar” no acredita ausencia. Los contactos se localizan por su descripción; consulta también los demás eventos. Historial como contexto, sin incorporar evidencias al caso abierto.</p><table className="student-history-comparison"><thead><tr><th scope="col">Dato de auditoría</th>{tickets.map(t => <th scope="col" key={t.id}>{t.externalCaseId ?? t.id}</th>)}</tr></thead><tbody>{fields.map(([label, read]) => {
    const values = details.map(d => read(d) || null), different = values[0] !== values[1];
    return <tr key={label} className={different ? 'bg-surface-2' : ''}><th scope="row">{label}{different && <small className="block text-brand">Valores distintos</small>}</th>{values.map((v, i) => <td key={details[i]!.case.id} className="whitespace-pre-wrap">{v ?? 'Sin registrar'}</td>)}</tr>;
  })}</tbody></table></>;
}
