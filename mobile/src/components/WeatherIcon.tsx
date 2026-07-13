import React from 'react';
import { StyleProp, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

// One weather icon for a WMO code. MCI's weather-* glyphs draw clouds as
// outlines, so anything with a cloud uses Ionicons' solid-fill glyphs instead
// (Apple Weather look); the gold MCI sun and fog stay because those look right.
// `night` swaps clear/partly-cloudy for moon variants.

const GOLD = '#F4C542';
const WHITE = '#FFFFFF';
const MOON = '#EDEFF5';
const RAIN = '#4FA3E3';

// Partly cloudy is two-tone (icon fonts are single-colour): gold sun / pale
// moon peeking out top-right behind a solid white cloud.
function PartlyCloudy({ night, size, style }: { night: boolean; size: number; style?: StyleProp<TextStyle> }) {
  return (
    <View style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]}>
      <Ionicons
        name={night ? 'moon' : 'sunny'}
        size={size * 0.62}
        color={night ? MOON : GOLD}
        style={{ position: 'absolute', top: 0, right: 0 }}
      />
      <Ionicons name="cloud" size={size * 0.78} color={WHITE} style={{ position: 'absolute', bottom: 0, left: 0 }} />
    </View>
  );
}

// Rain is two-tone like PartlyCloudy: the blue `rainy` glyph (cloud + drops)
// underneath, with a white `cloud` overlaid to cover the cloud so only the
// drops below stay blue (Apple Weather look).
function Rainy({ size, style }: { size: number; style?: StyleProp<TextStyle> }) {
  return (
    <View style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]}>
      <Ionicons name="rainy" size={size} color={RAIN} style={{ position: 'absolute', top: 0, left: 0 }} />
      <Ionicons
        name="cloud"
        size={size * 0.74}
        color={WHITE}
        style={{ position: 'absolute', top: size * 0.04, left: size * 0.13 }}
      />
    </View>
  );
}

// Thunderstorm is two-tone like Rainy: the gold `thunderstorm` glyph (cloud +
// bolt) underneath, with a white `cloud` overlaid to cover the cloud so only
// the lightning bolt below stays gold.
function Thunderstorm({ size, style }: { size: number; style?: StyleProp<TextStyle> }) {
  return (
    <View style={[{ width: size, height: size }, style as StyleProp<ViewStyle>]}>
      <Ionicons name="thunderstorm" size={size} color={GOLD} style={{ position: 'absolute', top: 0, left: 0 }} />
      <Ionicons
        name="cloud"
        size={size * 0.74}
        color={WHITE}
        style={{ position: 'absolute', top: size * 0.04, left: size * 0.13 }}
      />
    </View>
  );
}

type Spec = { ion?: React.ComponentProps<typeof Ionicons>['name']; mci?: string; color: string };

function spec(code: number, night: boolean): Spec {
  if (code <= 1) return night ? { ion: 'moon', color: MOON } : { mci: 'weather-sunny', color: GOLD };
  if (code === 3) return { ion: 'cloudy', color: WHITE };
  if (code === 45 || code === 48) return { mci: 'weather-fog', color: '#E8EEF4' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { ion: 'snow', color: '#EAF7FF' };
  return { ion: 'cloudy', color: WHITE };
}

export default function WeatherIcon({
  code,
  night = false,
  size,
  style,
}: {
  code: number;
  night?: boolean;
  size: number;
  style?: StyleProp<TextStyle>;
}) {
  if (code === 2) return <PartlyCloudy night={night} size={size} style={style} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <Rainy size={size} style={style} />;
  if (code >= 95) return <Thunderstorm size={size} style={style} />;
  const s = spec(code, night);
  if (s.ion) return <Ionicons name={s.ion} size={size} color={s.color} style={style} />;
  return <MaterialCommunityIcons name={s.mci as any} size={size} color={s.color} style={style} />;
}
