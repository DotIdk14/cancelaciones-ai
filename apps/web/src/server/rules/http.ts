import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'UNAUTHORIZED', message: 'Sesión requerida.' }, { status: 401 });
}

export function forbiddenResponse() {
  return NextResponse.json({ error: 'FORBIDDEN', message: 'Se requiere rol OWNER.' }, { status: 403 });
}

export function invalidJsonResponse() {
  return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON inválido.' }, { status: 400 });
}

export function invalidInputResponse(message: string) {
  return NextResponse.json({ error: 'INVALID_INPUT', message }, { status: 400 });
}

export function conflictResponse(message: string) {
  return NextResponse.json({ error: 'CONFLICT', message }, { status: 409 });
}

export function notFoundResponse(message = 'Recurso no encontrado.') {
  return NextResponse.json({ error: 'NOT_FOUND', message }, { status: 404 });
}

export function databaseErrorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Error de base de datos.';
  if (message.includes('RULE_VERSION_IMMUTABLE')) {
    return NextResponse.json({ error: 'RULE_VERSION_IMMUTABLE', message }, { status: 409 });
  }
  if (message.includes('RULE_NOT_FOUND')) return notFoundResponse('Regla no encontrada.');
  if (message.includes('DATABASE_DUPLICATE') || message.includes('duplicate key')) return conflictResponse(message);
  return NextResponse.json({ error: 'DATABASE_ERROR', message }, { status: 500 });
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const body = await request.json();
    return body as T;
  } catch {
    return null;
  }
}