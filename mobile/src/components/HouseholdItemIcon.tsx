import React from 'react';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// The "add a single item" mark: the three things you track under one roof —
// a structure/home (the roof), a vehicle (car) and an appliance (washing
// machine) grouped together. Built from glyph fonts + plain Views (no SVG
// dep) so it tints with `color` and scales with `size` like any other icon.
// The roof is a filled triangle drawn with the border trick; the car and
// washing machine are MCI glyphs sheltered beneath it.
export default function HouseholdItemIcon({
  size = 24,
  color = '#fff',
}: {
  size?: number;
  color?: string;
}) {
  const roofW = Math.round(size * 0.92);
  const roofH = Math.round(size * 0.34);
  const glyph = Math.round(size * 0.5);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Roof: a filled triangle pointing up, spanning the grouped items */}
      <View
        style={{
          position: 'absolute',
          top: Math.round(size * 0.04),
          width: 0,
          height: 0,
          borderLeftWidth: roofW / 2,
          borderRightWidth: roofW / 2,
          borderBottomWidth: roofH,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
      {/* Car + washing machine, side by side under the roof */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <MaterialCommunityIcons name="car" size={glyph} color={color} />
        <MaterialCommunityIcons name="washing-machine" size={glyph} color={color} />
      </View>
    </View>
  );
}
