import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import CalenChatIcon from './CalenChatIcon';

// The Calen button in the calendar's bottom-right floating pill. Phone-call
// outcomes are resolved on the event view (not surfaced here), so this stays a
// plain launcher with no call-status badge.
export default function AssistantButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress}>
      <CalenChatIcon size={24} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 12, paddingVertical: 6 },
});
