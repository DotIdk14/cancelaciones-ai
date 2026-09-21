import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cancelaciones AI',
  description: 'Asistente interno de auditoria de cancelaciones',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
