import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Chat-bubble outline with a sparkles glyph nested inside — used for the
// AI "Assistant" entry points (Calendar Assistant, Vacation Assistant, etc.).
export default function AssistantIcon({ size = 26, color = '#fff' }: { size?: number; color?: string }) {
  // Sparkles sit inside the bubble, slightly above the tail.
  const inner = Math.round(size * 0.5);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chatbubble-outline" size={size} color={color} />
      <Ionicons
        name="sparkles"
        size={inner}
        color={color}
        style={{ position: 'absolute', top: Math.round(size * 0.28), transform: [{ translateX: Math.round(size * 0.04) }] }}
      />
    </View>
  );
}
