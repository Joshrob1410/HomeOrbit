// app/(app)/rotas/layout.tsx
import type { ReactNode } from 'react';
import { requireFeature } from '@/app/(app)/_components/feature-gate';

export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature('ROTAS');
  return <>{children}</>;
}
