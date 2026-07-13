import { useRef } from 'react';
import { PanResponder } from 'react-native';

// Detects a deliberate horizontal swipe and fires onSwipeLeft / onSwipeRight
// once, on release. Built on core PanResponder (no gesture-handler dep, matching
// the rest of the app). Vertical scrolling and taps pass straight through — we
// only claim the gesture for a clearly horizontal drag.
//
// `enabled` is checked at gesture-decision time: return false to let the gesture
// fall through (e.g. when the touch started on a horizontally-scrollable child
// like the weather card's hourly strip, which needs its own left/right swipe).
export function useHorizontalSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled,
}: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabled?: () => boolean;
}) {
  const cbs = useRef({ onSwipeLeft, onSwipeRight, enabled });
  cbs.current = { onSwipeLeft, onSwipeRight, enabled };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => {
        if (cbs.current.enabled && !cbs.current.enabled()) return false;
        return Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
      },
      onPanResponderRelease: (_, g) => {
        // Require a decent horizontal throw so accidental drags don't flip days.
        if (Math.abs(g.dx) < 50) return;
        if (g.dx < 0) cbs.current.onSwipeLeft?.();
        else cbs.current.onSwipeRight?.();
      },
    })
  ).current;

  return pan.panHandlers;
}
