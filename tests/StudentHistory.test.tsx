// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StudentHistory } from '../src/components/StudentHistory';
import { previewStudentHistory } from '../src/lib/local-student-history-preview';
import { getStudentHistory, getCase, reconcileCaseRequests } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ getStudentHistory: vi.fn(), getCase: vi.fn(), getHistoricalAudit: vi.fn(), reconcileCaseRequests: vi.fn() }));
vi.mock('../src/components/AuditResultPanel', () => ({ AuditResultPanel: () => <p>Versión original</p> }));
const histories = { ...previewStudentHistory, studentIdentifier: '0000123', items: previewStudentHistory.items.map(i=>({...i,isTest:false})) };
beforeEach(()=>{
 cleanup(); vi.clearAllMocks(); window.history.replaceState({},'', '/');
 vi.mocked(getStudentHistory).mockResolvedValue(histories);
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}});
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(){this.removeAttribute('open');}});
});
describe('historial consultivo de matrícula',()=>{
 it('la vista local abre el panel con contadores separados sin API ni sesión',async()=>{
 render(<StudentHistory caseId="demo" studentIdentifier="0000123" canReconcile={false} previewHistory={histories} />);
 fireEvent.click(screen.getByRole('button',{name:'Ver historial'}));
 expect(screen.getByRole('dialog',{name:'Historial de matrícula · 0000123'})).toBeTruthy();
 expect(screen.getByText(/3 ejecuciones de auditoría/)).toBeTruthy();
 expect(getStudentHistory).not.toHaveBeenCalled(); expect(getCase).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cerrar historial'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('compara solicitudes independientes y evidencia por origen; lectura no concilia ni llama IA',async()=>{
 vi.mocked(getCase).mockImplementation(async id=>({case:{id,externalCaseId:'CaVe-'+id,flokzuData:{procedure:{policyReported:'Política reportada',requestDate:'2026-10-01',motive:'Motivo registrado'}}},evidences:[{id:'e-'+id,caseId:id,filename:id+'.pdf',mimeType:'application/pdf',createdAt:'2026-10-01',processingStatus:'READY',hash:'hash-'+id}],audit:{resultJson:{audit:{result:id==='demo-1'?'BAJA':'CANCELACION_VENTA',procedureSection:'3'}}},effectiveResolution:null,auditIsCurrent:false}) as unknown as Awaited<ReturnType<typeof getCase>>);
 render(<StudentHistory caseId="demo-1" studentIdentifier="0000123" canReconcile={false} />);
 await waitFor(()=>expect(screen.getByText(/expediente adicional/)).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Ver historial'}));
 await waitFor(()=>expect(screen.getByLabelText('Comparar CaVe-DEMO-1')).toBeTruthy());
 fireEvent.click(screen.getByLabelText('Comparar CaVe-DEMO-1'));fireEvent.click(screen.getByLabelText('Comparar CaVe-DEMO-2'));
 fireEvent.click(screen.getByRole('button',{name:'Comparar dos expedientes'}));
 await waitFor(()=>expect(screen.getByText(/Comparación de datos registrados, sin IA/)).toBeTruthy());
 expect(screen.getByText(/demo-1\.pdf · application\/pdf/)).toBeTruthy(); expect(screen.getByText(/SHA-256: hash-demo-1/)).toBeTruthy();
 expect(getCase).toHaveBeenCalledTimes(2);expect(reconcileCaseRequests).not.toHaveBeenCalled();
 expect(screen.queryByText('Conciliación de Coordinación')).toBeNull();
 });
});
