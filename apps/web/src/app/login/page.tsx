import { signIn } from '@/server/actions/auth';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-brand">Cancelaciones AI</p>
        <h1 className="mt-3 text-3xl font-bold text-ink">Iniciar sesion</h1>
        <p className="mt-2 text-sm text-slate-600">Acceso privado para el area de Cancelaciones.</p>
        {params.error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            No fue posible iniciar sesion. Verifica tus credenciales.
          </div>
        ) : null}
        <form action={signIn} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Correo
            <input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-brand" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Contrasena
            <input name="password" type="password" required className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-brand" />
          </label>
          <button type="submit" className="w-full rounded-xl bg-brand px-4 py-2.5 font-semibold text-white hover:bg-teal-800">
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}
