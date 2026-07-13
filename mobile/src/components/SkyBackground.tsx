import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

// Full-screen sky gradient behind the weather screen (Apple Weather style),
// tinted by the current WMO code + local time of day. On clear/partly-cloudy
// daytime it adds a soft sun glare in the top-left that slowly drifts.
// Uses RN 0.85's built-in gradient style (experimental_backgroundImage) so no
// native module is needed — the whole effect is JS-reload safe.

function isNight() {
  const h = new Date().getHours();
  return h < 6 || h >= 20;
}

// top → horizon colours per condition, kept dark enough at the horizon that
// the app's light text stays readable on the translucent cards above it.
function palette(code: number | undefined, night: boolean): [string, string] {
  if (night) {
    if (code === undefined || code <= 2) return ['#0B1430', '#27395E']; // clear night
    return ['#0F141D', '#28303C']; // any weather at night
  }
  if (code === undefined || code <= 1) return ['#2E71C9', '#8FBBE8']; // clear
  if (code === 2) return ['#4A7CB8', '#96B4D2'];                      // partly cloudy
  if (code === 3 || code === 45 || code === 48) return ['#5B6672', '#98A3AE']; // overcast / fog
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['#39485D', '#6A7B8F']; // rain
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['#6E7F94', '#ABB9C7']; // snow
  if (code >= 95) return ['#2A3242', '#4E586B'];                      // thunderstorm
  return ['#4A7CB8', '#96B4D2'];
}

export default function SkyBackground({ weatherCode }: { weatherCode?: number }) {
  const night = isNight();
  const [top, horizon] = palette(weatherCode, night);
  const sunny = !night && (weatherCode === undefined || weatherCode <= 2);

  // 0→1 over ~80s, reversing forever; drives a slow diagonal drift of the glare.
  const drift = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!sunny) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 80000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 80000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sunny, drift]);

  const glareStyle = {
    transform: [
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 46] }) },
      { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 30] }) },
      { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
    ],
  };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          StyleSheet.absoluteFill,
          { experimental_backgroundImage: `linear-gradient(180deg, ${top} 0%, ${horizon} 100%)` },
        ]}
      />
      {sunny ? (
        <>
          <Animated.View style={[styles.sun, glareStyle]} />
          <Animated.View style={[styles.flare, glareStyle]} />
        </>
      ) : null}
    </View>
  );
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
});
