import React from 'react';
import { View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme';

// Calen's mark: a chat bubble with a friendly face inside, used at every
// "talk to Calen" entry point (chat FABs, form assist, chat empty states).
// The bubble is the Ionicons outline glyph so the stroke weight matches the
// rest of the icon set; the face is drawn with plain Views (no SVG dep) so
// it tints with `color` and scales with `size` like any other icon.
//
// `accessory` docks a small domain badge (wrench, calendar, suitcase, …) at
// the bubble's bottom-right corner — one Calen, different hats per surface.
// The badge is a `color` disc with the glyph knocked out in `badgeColor`
// (pass the backdrop colour when not on the default screen background). It
// auto-hides below 24px, where a badge glyph is illegible.
export default function AssistantIcon({
  size = 26,
  color = '#fff',
  accessory,
  badgeColor = colors.background,
}: {
  size?: number;
  color?: string;
  accessory?: keyof typeof MaterialCommunityIcons.glyphMap;
  badgeColor?: string;
}) {
  const eye = Math.max(2, Math.round(size * 0.11));
  const smileW = Math.round(size * 0.36);
  const smileH = Math.round(size * 0.18);
  const stroke = Math.max(1.5, Math.round(size * 0.06));
  const badge = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chatbubble-outline" size={size} color={color} />
      {/* Eyes */}
      <View
        style={{
          position: 'absolute',
          top: Math.round(size * 0.3),
          flexDirection: 'row',
          columnGap: Math.round(size * 0.14),
        }}
      >
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
      </View>
      {/* Smile: bottom arc of a transparent box (only the bottom border is tinted) */}
      <View
        style={{
          position: 'absolute',
          top: Math.round(size * 0.42),
          width: smileW,
          height: smileH,
          borderWidth: stroke,
          borderColor: 'transparent',
          borderBottomColor: color,
          borderBottomLeftRadius: smileH,
          borderBottomRightRadius: smileH,
        }}
      />
      {accessory && size >= 24 ? (
        <View
          style={{
            position: 'absolute',
            right: -Math.round(size * 0.04),
            bottom: Math.round(size * 0.04),
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name={accessory} size={Math.round(badge * 0.62)} color={badgeColor} />
        </View>
      ) : null}
    </View>
  );
}
