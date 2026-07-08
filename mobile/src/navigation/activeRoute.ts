import { useEffect, useState } from 'react';

// Tracks the current top-level route name so app-wide overlays (e.g. the
// cloud-purge StorageBanner) can scope themselves to a subset of screens. Fed by
// NavigationContainer's onReady/onStateChange in RootNavigator; read via the hook.
// Mirrors the tiny subscriber-store pattern used by lib/storageState.

let current: string | null = null;
const subs = new Set<() => void>();

export function setActiveRoute(name: string | null) {
  if (name === current) return;
  current = name;
  subs.forEach((fn) => fn());
}

export function useActiveRoute(): string | null {
  const [s, setS] = useState(current);
  useEffect(() => {
    const sub = () => setS(current);
    subs.add(sub);
    setS(current); // sync in case it changed between render and effect
    return () => {
      subs.delete(sub);
    };
  }, []);
  return s;
}
