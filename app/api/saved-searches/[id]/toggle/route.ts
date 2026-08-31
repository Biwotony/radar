import { NextResponse } from 'next/server';

import { authRepository, currentUser } from '../../../../lib/authServer';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/alerts?error=login_required', request.url), 303);

  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.redirect(new URL('/alerts?error=not_found', request.url), 303);
  const form = await request.formData();
  const active = String(form.get('active')) === 'true';
  const updated = await authRepository().setSavedSearchActive(user.id, id, active);
  return NextResponse.redirect(new URL(updated ? '/alerts' : '/alerts?error=not_found', request.url), 303);
}
