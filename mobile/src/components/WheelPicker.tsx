import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { colors } from '../theme';

export const WHEEL_ITEM_H = 40;
export const WHEEL_VISIBLE = 5; // odd, so one row sits centered under the selection band

// Pure-JS scrolling wheel that mimics the native spinner: a snap-to-row
// ScrollView whose rows tilt (rotateX), shrink, and fade as they move away
// from the center line, driven by the scroll position on the native thread.
// The selection band is drawn by the caller (it may span several wheels).
export default function WheelPicker<T extends string | number>({
  items,
  value,
  onChange,
  width = 88,
}: {
  items: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  width?: number;
}) {
  const ref = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  // Position on the starting row exactly once — re-applying it on re-renders
  // (as a contentOffset prop would) kills in-flight momentum dead.
  const positioned = useRef(false);
  const pad = ((WHEEL_VISIBLE - 1) / 2) * WHEEL_ITEM_H;

  const settle = (y: number) => {
    const i = Math.min(items.length - 1, Math.max(0, Math.round(y / WHEEL_ITEM_H)));
    onChange(items[i].value);
  };

  return (
    <View style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE, width }}>
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        onLayout={() => {
          if (positioned.current) return;
          positioned.current = true;
          const y = Math.max(0, items.findIndex((it) => it.value === value)) * WHEEL_ITEM_H;
          ref.current?.scrollTo({ y, animated: false });
          scrollY.setValue(y);
        }}
        contentContainerStyle={{ paddingVertical: pad }}
        // Momentum-end fires after the snap; drag-end covers releases without a fling.
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => settle(e.nativeEvent.contentOffset.y)}
      >
        {items.map((it, i) => {
          // How this row transforms as the wheel turns: flat and opaque when
          // centered, tilting away and fading over the two rows to either side.
          const inputRange = [(i - 2) * WHEEL_ITEM_H, (i - 1) * WHEEL_ITEM_H, i * WHEEL_ITEM_H, (i + 1) * WHEEL_ITEM_H, (i + 2) * WHEEL_ITEM_H];
          const opacity = scrollY.interpolate({
            inputRange,
            outputRange: [0.2, 0.45, 1, 0.45, 0.2],
            extrapolate: 'clamp',
          });
          const scale = scrollY.interpolate({
            inputRange,
            outputRange: [0.78, 0.9, 1, 0.9, 0.78],
            extrapolate: 'clamp',
          });
          const rotateX = scrollY.interpolate({
            inputRange,
            outputRange: ['52deg', '28deg', '0deg', '-28deg', '-52deg'],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={String(it.value)}
              style={[styles.item, { opacity, transform: [{ perspective: 600 }, { rotateX }, { scale }] }]}
            >
              <Text style={styles.itemText}>{it.label}</Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 23, color: colors.text },
});
