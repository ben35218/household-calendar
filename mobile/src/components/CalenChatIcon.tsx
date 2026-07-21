import React from 'react';
import { View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// Calen's chat mark: a solid-fill chat bubble with the Calsans "C" inside it.
// The bubble is filled `color` (white on the dark floating pill); the C is the
// app's primary blue, knocked out of the bubble. The C is the `calen-c-mark`
// silhouette (see assets/calen-c-mark.png) tinted with `cColor` so it stays
// crisp at any size and matches the brand glyph exactly.
export default function CalenChatIcon({
  size = 26,
  color = '#fff',
  cColor = colors.primary,
}: {
  size?: number;
  color?: string;
  cColor?: string;
}) {
  // The C sits in the bubble's body, nudged up to clear the tail at the bottom.
  const cSize = Math.round(size * 0.5);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chatbubble" size={size} color={color} />
      <Image
        source={require('../../assets/calen-c-mark.png')}
        style={{
          position: 'absolute',
          top: Math.round(size * 0.24),
          width: cSize,
          height: cSize,
          tintColor: cColor,
          resizeMode: 'contain',
        }}
      />
    </View>
  );
}
