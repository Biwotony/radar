import { NextResponse } from 'next/server';

import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashToken,
  newOpaqueToken,
} from '../../../../src/auth';
import { authRepository, sessionCookieOptions } from '../../../lib/authServer';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawMagicToken = url.searchParams.get('token');
  if (!rawMagicToken) return NextResponse.redirect(new URL('/alerts?error=invalid_link', request.url));

  const rawSessionToken = newOpaqueToken();
  const now = new Date();
  const user = await authRepository().consumeMagicLink(
    hashToken(rawMagicToken),
    now,
    hashToken(rawSessionToken),
    new Date(now.getTime() + SESSION_TTL_MS),
  );

  if (!user) return NextResponse.redirect(new URL('/alerts?error=expired_link', request.url));

  const response = NextResponse.redirect(new URL('/alerts', request.url));
  response.cookies.set(SESSION_COOKIE, rawSessionToken, sessionCookieOptions(Math.floor(SESSION_TTL_MS / 1000)));
  return response;
}
