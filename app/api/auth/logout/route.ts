import { NextResponse } from 'next/server';

import { SESSION_COOKIE, hashToken } from '../../../../src/auth';
import { authRepository } from '../../../lib/authServer';

export async function POST(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const rawToken = match ? decodeURIComponent(match[1] ?? '') : null;
  if (rawToken) await authRepository().revokeSession(hashToken(rawToken));

  const response = NextResponse.redirect(new URL('/alerts', request.url), 303);
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.AUTH_COOKIE_SECURE !== 'false', path: '/', maxAge: 0 });
  return response;
}
