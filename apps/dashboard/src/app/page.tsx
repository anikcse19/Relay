import { redirect } from 'next/navigation';
import { getMe, homePath } from '@/lib/api.server';

/** `/` has no content of its own: send people to sign-in or their workspace. */
export default async function Home() {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  const path = homePath(me);
  if (!path) throw new Error('Your account has no workspace. Please contact support.');
  redirect(path);
}
