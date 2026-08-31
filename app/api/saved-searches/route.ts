import { NextResponse } from 'next/server';

import { validateSavedSearch } from '../../../src/auth';
import { authRepository, currentUser } from '../../lib/authServer';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL('/alerts?error=login_required', request.url), 303);

  const form = await request.formData();
  const university = String(form.get('university') ?? '');
  const maxRent = Number(form.get('maxRent'));
  const moveIn = String(form.get('moveInMonth') ?? '').trim();
  const housingTypes = form.getAll('type').map(String);

  try {
    const input = validateSavedSearch({
      university: university === 'goethe' ? 'goethe' : university === 'frankfurt_uas' ? 'frankfurt_uas' : (university as never),
      maxTotalMonthlyRent: maxRent,
      moveInMonth: moveIn ? `${moveIn}-01` : null,
      housingTypes,
    });
    await authRepository().createSavedSearch(user.id, input);
  } catch {
    return NextResponse.redirect(new URL('/alerts?error=invalid_search', request.url), 303);
  }

  return NextResponse.redirect(new URL('/alerts?created=1', request.url), 303);
}
