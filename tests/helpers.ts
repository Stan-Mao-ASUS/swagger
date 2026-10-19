import type { Miniflare } from 'miniflare';
type DispatchResponse = Awaited<ReturnType<Miniflare['dispatchFetch']>>;
// Tests assert on JSON they produced themselves, so responses expose it untyped.
export type JsonResponse = Omit<DispatchResponse, 'json'> & { json(): Promise<any> };
import { D1Adapter } from '@auth/d1-adapter';
import type { Adapter, AdapterUser } from '@auth/core/adapters';
type TestAdapter = Required<Pick<Adapter, 'createUser' | 'createSession' | 'linkAccount' | 'getUserByAccount' | 'getUserByEmail' | 'getSessionAndUser' | 'deleteSession'>>;
// The real D1 adapter with its optional methods marked present; createUser assigns the id itself.
export function testAdapter(db: Parameters<typeof D1Adapter>[0]): Omit<TestAdapter, 'createUser'> & { createUser(user: Omit<AdapterUser, 'id' | 'image'> & { image?: string | null }): Promise<AdapterUser> } {
  return D1Adapter(db) as any;
}
