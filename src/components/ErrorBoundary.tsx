// =============================================================================
// Frontera de errores: evita pantalla en blanco ante un fallo de render.
// =============================================================================

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Solo consola: nunca se exponen stack traces al usuario final.
    console.error('[ui] error en render:', error.message, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-danger/40 bg-surface-1 p-6">
          <h1 className="text-lg font-semibold text-danger">La aplicación falló</h1>
          <p className="mt-2 text-sm text-muted">
            Ocurrió un error inesperado al mostrar esta vista. Recarga la página para continuar; si el
            problema persiste, contacta al equipo de soporte.
          </p>
          <div className="mt-4">
            <Button variant="primary" onClick={this.handleReload}>
              Recargar página
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
