import { NextResponse } from 'next/server';

import {
  MAGIC_LINK_TTL_MS,
  hashToken,
  newOpaqueToken,
  normalizeEmail,
  validEmail,
} from '../../../../src/auth';
import { authRepository, sendMagicLink } from '../../../lib/authServer';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = normalizeEmail(String(form.get('email') ?? ''));
  if (!validEmail(email)) return NextResponse.redirect(new URL('/alerts?error=invalid_email', request.url), 303);

  const rawToken = newOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
  const repository = authRepository();
  const claim = await repository.claimMagicLink(email, hashToken(rawToken), now, expiresAt);

  // Rate-limited requests return the same response as successful requests so this
  // anonymous endpoint does not reveal whether an address already has an account.
  if (claim.status === 'rate_limited') {
    return NextResponse.redirect(new URL('/alerts?sent=1', request.url), 303);
  }

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) throw new Error('APP_BASE_URL is required for magic links');
  const verifyUrl = new URL('/api/auth/verify', appBaseUrl);
  verifyUrl.searchParams.set('token', rawToken);

  try {
    await sendMagicLink(email, verifyUrl.toString());
    await repository.markMagicLinkSent(claim.tokenId);
  } catch (error) {
    await repository.markMagicLinkFailed(claim.tokenId, error instanceof Error ? error.message : String(error));
    return NextResponse.redirect(new URL('/alerts?error=send_failed', request.url), 303);
  }

  return NextResponse.redirect(new URL('/alerts?sent=1', request.url), 303);
}
