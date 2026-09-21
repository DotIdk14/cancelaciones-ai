import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/session';
import { signOut } from '@/server/actions/auth';

export const dynamic = 'force-dynamic';

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">Cancelaciones AI</p>
            <p className="text-sm text-slate-500">Sesion activa</p>
          </div>
          <form action={signOut}>
            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Cerrar sesion
            </button>
          </form>
        </div>
      </header>
      {children}
    </main>
  );
}
