import React from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { isNight, skyKind, skyPalette } from '../lib/weatherTheme';

// Full-screen sky gradient behind the weather screen (Apple Weather style),
// tinted by the current WMO code + local time of day, with a condition-specific
// animated overlay on top: sun glare on a clear day, a moon glow + stars on a
// clear night, drifting clouds, fog bands, falling rain, falling snow, or a
// lightning flash for thunderstorms. Uses RN 0.85's built-in gradient style
// (experimental_backgroundImage) so no native module is needed — the whole
// effect is JS-reload safe.

const { width: W, height: H } = Dimensions.get('window');

export default function SkyBackground({ weatherCode }: { weatherCode?: number }) {
  const night = isNight();
  const [top, horizon] = skyPalette(weatherCode, night);
  const kind = skyKind(weatherCode);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: `linear-gradient(180deg, ${top} 0%, ${horizon} 100%)` },
        ]}
      />
      {kind === 'clear' && !night ? <SunGlare /> : null}
      {kind === 'clear' && night ? <MoonGlow /> : null}
      {kind === 'clouds' ? <Clouds night={night} /> : null}
      {kind === 'fog' ? <Fog /> : null}
      {kind === 'rain' ? <Rain /> : null}
      {kind === 'snow' ? <Snow /> : null}
      {kind === 'storm' ? (
        <>
          <Rain heavy />
          <Lightning />
        </>
      ) : null}
    </View>
  );
}

// ── Clear day: soft low-sun glare drifting diagonally in the top-left ──────────
function SunGlare() {
  const drift = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 80000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 80000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const style = {
    transform: [
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 46] }) },
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) },
      { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
    ],
  };
  return (
    <>
      <Animated.View style={[styles.sun, style]} />
      <Animated.View style={[styles.flare, style]} />
    </>
  );
}

// ── Clear night: cool moon glow in the top-right + a scatter of static stars ───
function MoonGlow() {
  const stars = React.useMemo(
    () =>
      Array.from({ length: 26 }, () => ({
        left: Math.random() * W,
        top: Math.random() * H * 0.6,
        size: Math.random() < 0.3 ? 2.5 : 1.5,
        opacity: 0.35 + Math.random() * 0.5,
      })),
    [],
  );
  return (
    <>
      {stars.map((s, i) => (
        <View
          key={i}
          style={{ position: 'absolute', left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: s.size, backgroundColor: `rgba(255,255,255,${s.opacity})` }}
        />
      ))}
      <View style={styles.moon} />
    </>
  );
}

// ── Overcast / partly cloudy: a few big soft puffs drifting slowly sideways ────
function Clouds({ night }: { night: boolean }) {
  const tint = night ? 'rgba(150,160,180,0.30)' : 'rgba(255,255,255,0.45)';
  const puffs = React.useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        top: 20 + i * (H * 0.14) + Math.random() * 30,
        size: 220 + Math.random() * 160,
        dur: 26000 + Math.random() * 22000,
        from: -Math.random() * W * 0.5,
      })),
    [],
  );
  return (
    <>
      {puffs.map((p, i) => (
        <Cloud key={i} tint={tint} {...p} />
      ))}
    </>
  );
}

function Cloud({ top, size, dur, from, tint }: { top: number; size: number; dur: number; from: number; tint: string }) {
  const x = React.useRef(new Animated.Value(from)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(x, { toValue: W + size, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [x, dur, size]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top,
        left: -size,
        width: size,
        height: size * 0.6,
        transform: [{ translateX: x }],
        experimental_backgroundImage: `radial-gradient(ellipse at center, ${tint} 0%, ${tint.replace(/[\d.]+\)$/, '0)')} 65%)`,
      }}
    />
  );
}

// ── Fog: wide, near-static translucent bands that breathe in and out ──────────
function Fog() {
  const bands = React.useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        top: H * (0.2 + i * 0.18),
        dur: 9000 + Math.random() * 6000,
      })),
    [],
  );
  return (
    <>
      {bands.map((b, i) => (
        <FogBand key={i} {...b} />
      ))}
    </>
  );
}

function FogBand({ top, dur }: { top: number; dur: number }) {
  const o = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(o, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [o, dur]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: -40,
        right: -40,
        top,
        height: 120,
        opacity: o.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.32] }),
        experimental_backgroundImage:
          'linear-gradient(180deg, rgba(230,236,244,0) 0%, rgba(230,236,244,0.9) 50%, rgba(230,236,244,0) 100%)',
      }}
    />
  );
}

// ── Rain: thin slanted streaks falling on a loop ──────────────────────────────
function Rain({ heavy }: { heavy?: boolean }) {
  const drops = React.useMemo(
    () =>
      Array.from({ length: heavy ? 70 : 44 }, () => {
        const len = 14 + Math.random() * 18;
        return {
          left: Math.random() * (W + 40) - 20,
          len,
          start: Math.random() * (H + len) - len,
          dur: 650 + Math.random() * 450,
          opacity: 0.2 + Math.random() * 0.3,
        };
      }),
    [heavy],
  );
  return (
    <>
      {drops.map((d, i) => (
        <Drop key={i} {...d} />
      ))}
    </>
  );
}

function Drop({ left, len, start, dur, opacity }: { left: number; len: number; start: number; dur: number; opacity: number }) {
  const y = React.useRef(new Animated.Value(start)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(y, { toValue: H + len, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [y, dur, len]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top: -len,
        width: 1.5,
        height: len,
        borderRadius: 1,
        backgroundColor: `rgba(205,222,240,${opacity})`,
        transform: [{ translateY: y }, { rotate: '14deg' }],
      }}
    />
  );
}

// ── Snow: soft round flakes falling slowly with a gentle sideways sway ────────
function Snow() {
  const flakes = React.useMemo(
    () =>
      Array.from({ length: 40 }, () => {
        const size = 3 + Math.random() * 5;
        return {
          left: Math.random() * W,
          size,
          start: Math.random() * (H + size) - size,
          dur: 5000 + Math.random() * 5000,
          sway: 14 + Math.random() * 22,
          swayDur: 2200 + Math.random() * 1800,
          opacity: 0.5 + Math.random() * 0.4,
        };
      }),
    [],
  );
  return (
    <>
      {flakes.map((f, i) => (
        <Flake key={i} {...f} />
      ))}
    </>
  );
}

function Flake({ left, size, start, dur, sway, swayDur, opacity }: { left: number; size: number; start: number; dur: number; sway: number; swayDur: number; opacity: number }) {
  const y = React.useRef(new Animated.Value(start)).current;
  const sx = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const fall = Animated.loop(
      Animated.timing(y, { toValue: H + size, duration: dur, easing: Easing.linear, useNativeDriver: true }),
    );
    const drift = Animated.loop(
      Animated.sequence([
        Animated.timing(sx, { toValue: 1, duration: swayDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sx, { toValue: -1, duration: swayDur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    fall.start();
    drift.start();
    return () => { fall.stop(); drift.stop(); };
  }, [y, sx, dur, swayDur, size]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top: -size,
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: `rgba(255,255,255,${opacity})`,
        transform: [{ translateY: y }, { translateX: sx.interpolate({ inputRange: [-1, 1], outputRange: [-sway, sway] }) }],
      }}
    />
  );
}

// ── Thunderstorm: occasional double-blink white flash over the whole sky ──────
function Lightning() {
  const o = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(4000 + Math.random() * 5000),
        Animated.timing(o, { toValue: 0.55, duration: 70, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.delay(90),
        Animated.timing(o, { toValue: 0.35, duration: 60, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [o]);
  return <Animated.View style={[StyleSheet.absoluteFill, styles.lightning, { opacity: o }]} />;
}

const styles = StyleSheet.create({
  // Big soft glow mostly offscreen top-left, like low sun catching the lens.
  sun: {
    position: 'absolute',
    top: -180,
    left: -160,
    width: 520,
    height: 520,
    experimental_backgroundImage:
      'radial-gradient(circle, rgba(255,246,220,0.85) 0%, rgba(255,240,200,0.28) 38%, rgba(255,240,200,0) 68%)',
  },
  // Faint secondary lens-flare ring further down the diagonal.
  flare: {
    position: 'absolute',
    top: 150,
    left: 90,
    width: 140,
    height: 140,
    experimental_backgroundImage:
      'radial-gradient(circle, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0) 70%)',
  },
  // Cool moon glow tucked into the top-right on a clear night.
  moon: {
    position: 'absolute',
    top: -140,
    right: -150,
    width: 460,
    height: 460,
    experimental_backgroundImage:
      'radial-gradient(circle, rgba(214,226,246,0.55) 0%, rgba(190,206,236,0.16) 40%, rgba(190,206,236,0) 68%)',
  },
  lightning: { backgroundColor: '#EAF1FF' },
});
