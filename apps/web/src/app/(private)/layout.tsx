import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function PrivateLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <main className="min-h-screen bg-background text-ink">
      {children}
    </main>
  );
}
