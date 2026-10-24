import type { AuditDetail, ContactRequest } from '../lib/api';
import { needsContactConfirmation } from '../shared/audit-contact';
import { formatDateTime } from '../lib/format';
import { Button } from './ui';

export function ContactConfirmationNotice({ audit, request, canConfirm, busy, onAnswer }: {
  audit: AuditDetail | null;
  request?: ContactRequest | null;
  canConfirm: boolean;
  busy: boolean;
  onAnswer: (performed: boolean) => void;
}) {
  const confirmation = audit?.providerMetadata?.contactConfirmation;
  if (!request && confirmation?.performed === true) {
    return <p role="status" className="text-sm text-muted">Contacto confirmado por el equipo el {formatDateTime(confirmation.confirmedAt)}. La auditoría considera esta confirmación humana; no acredita los conteos de intentos.</p>;
  }
  if (!request && !needsContactConfirmation(audit)) return null;
  return <section role="alert" aria-labelledby="contact-confirmation-title" className="rounded-xl border border-warning/30 bg-warning/5 p-4">
    <h2 id="contact-confirmation-title" className="text-sm font-semibold text-ink">{request ? 'Antes de iniciar la auditoría' : 'Confirmar contacto antes de reintentar'}</h2>
    <p className="mt-2 text-sm text-muted">¿Se realizó contacto con el estudiante? La IA espera tu respuesta antes de analizar el expediente; esta pausa no consume tokens. Si confirmas que sí, la respuesta se guardará con tu usuario y fecha. No acredita conteos de llamadas ni mensajes.</p>
    {(request?.declined || confirmation?.performed === false) && <p role="status" className="mt-2 text-sm text-warning">Indicaste que no se realizó contacto. La auditoría permanece detenida sin consumir IA. Realiza el contacto o agrega los registros faltantes antes de continuar.</p>}
    {canConfirm ? <div className="mt-3 flex flex-wrap gap-2">
      {request ? <><Button disabled={busy} onClick={() => onAnswer(true)}>Sí, se realizó contacto. Continuar auditoría</Button>
      <Button variant="secondary" disabled={busy} onClick={() => onAnswer(false)}>No se realizó contacto</Button></> : <Button disabled={busy} onClick={() => onAnswer(true)}>Revisar contacto antes de reintentar</Button>}
    </div> : <p className="mt-2 text-sm text-muted">Una persona con permiso para auditar debe registrar la respuesta.</p>}
  </section>;
}
