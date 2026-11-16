import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/auth';
import { NextResponse } from 'next/server';

type SessionUser = { id: string; name?: string | null; email?: string | null };

/**
 * Every user must be signed in with GitHub. These return null when there is no
 * real session; API routes respond 401 and pages redirect to /login.
 */
export async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}

export async function getSession(): Promise<{ user: SessionUser } | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? (session as { user: SessionUser }) : null;
}

export async function getForgeSession(): Promise<{ user: SessionUser } | null> {
  return getSession();
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
