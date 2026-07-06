import { useCallback, useState } from 'react';

// Tracks which form fields the AI assistant last changed, so a screen can both
// highlight them (`highlight={changed.has('title')}`) and clear a field's
// highlight once the user edits it manually.
export function useFormAssist() {
  const [changed, setChanged] = useState<Set<string>>(new Set());

  // Mark fields as AI-changed (replaces the previous highlight set).
  const mark = useCallback((keys: string[]) => {
    setChanged(new Set(keys));
  }, []);

  // Add fields to the highlight set without clearing existing ones (e.g. a value
  // resolved asynchronously after the initial fill).
  const add = useCallback((keys: string[]) => {
    setChanged((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  // Drop the highlight on specific fields (e.g. once the user edits them).
  const clear = useCallback((keys: string[]) => {
    setChanged((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      keys.forEach((k) => next.delete(k));
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setChanged(new Set()), []);

  return { changed, mark, add, clear, clearAll };
}
