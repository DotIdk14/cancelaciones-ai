// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FactGroundingDetails } from '../src/components/FactGroundingDetails';
import type { Evidence } from '../src/lib/api';
afterEach(cleanup);
it('permite contrastar una inferencia con su cita y abrir la evidencia original',()=>{
 const open=vi.fn();render(<FactGroundingDetails grounding={{factKey:'intent',support:'INFERRED',explanation:'Conclusión condicionada a la lectura del mensaje',citations:[{evidenceId:'ev-1',quote:'¿Me ayudan a ingresar?',locator:'página 1'}]}} evidences={[{id:'ev-1',filename:'synthetic.png',mimeType:'image/png'} as Evidence]} onOpen={open}/>);
 fireEvent.click(screen.getByText('Ver sustento contrastado por IA'));
 expect(screen.getByText(/Inferencia de IA/)).toBeTruthy();expect(screen.getByText('¿Me ayudan a ingresar?')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Ver synthetic.png'}));expect(open).toHaveBeenCalledWith('ev-1',null);
});
it('no inventa revisión de sustento en un histórico sin ella',()=>{
 const {container}=render(<FactGroundingDetails grounding={undefined} evidences={[]} onOpen={()=>{}}/>);expect(container.textContent).toBe('');
});
