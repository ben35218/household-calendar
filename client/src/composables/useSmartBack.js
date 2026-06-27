import { useRouter, useRoute } from 'vue-router';

// Returns a function that navigates "back" intelligently:
//   - If the route declares `meta.backTo`, always go there regardless of history
//     (top-level section pages that should anchor to a fixed home).
//   - Otherwise, if there is in-app history, go back to it (preserves the user's
//     real path).
//   - Otherwise (deep link, refresh, external referrer), fall back to the
//     route's declared `meta.parent`, or /calendar.
//
// `meta.backTo` and `meta.parent` may each be a string path or a function `(route) => path`.
export function useSmartBack() {
  const router = useRouter();
  const route = useRoute();

  return () => {
    const forced = route.meta?.backTo;
    if (forced != null) {
      router.push(typeof forced === 'function' ? forced(route) : forced);
      return;
    }
    if (window.history.state?.back != null) {
      router.back();
      return;
    }
    const parent = route.meta?.parent;
    const fallback = typeof parent === 'function' ? parent(route) : parent;
    router.push(fallback ?? '/calendar');
  };
}

// Returns a function `returnTo(target)` for navigating after a save/delete.
//   - If `target` is the entry directly behind us in history (editing a detail
//     we came from, or deleting back to the list we came from), navigate back
//     to that live entry — this keeps its back-chain intact and avoids leaving
//     a duplicate, self-referential history entry behind us.
//   - Otherwise (creating a brand-new record that isn't in history yet), replace
//     the current form entry so back never returns to the form.
export function useReturnTo() {
  const router = useRouter();

  return (target) => {
    if (window.history.state?.back === target) {
      router.back();
    } else {
      router.replace(target);
    }
  };
}
