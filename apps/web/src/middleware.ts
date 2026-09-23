import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@insforge/sdk/ssr/middleware';

const privatePrefixes = ['/auditorias'];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (process.env.LOCAL_DEMO === '1' || process.env.NEXT_PUBLIC_LOCAL_DEMO === '1') {
    return response;
  }

  await updateSession({ requestCookies: request.cookies, responseCookies: response.cookies });

  const isPrivatePath = privatePrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  const hasAccessToken = request.cookies.has('insforge_access_token');

  if (isPrivatePath && !hasAccessToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
