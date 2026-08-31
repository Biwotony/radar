import { NextResponse } from 'next/server';

import { authRepository, currentUser } from '../../../../lib/authServer';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/alerts?error=login_required', request.url), 303);

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.redirect(new URL('/alerts?error=not_found', request.url), 303);
  const deleted = await authRepository().deleteSavedSearch(user.id, id);
  return NextResponse.redirect(new URL(deleted ? '/alerts' : '/alerts?error=not_found', request.url), 303);
}
