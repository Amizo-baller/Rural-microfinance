import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export function GoogleSignInButton({ disabled, onPress }: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Sign in with Google"
      accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}>
      <Svg width={20} height={20} viewBox="0 0 48 48" accessible={false}>
        <Path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.4 9.4 0 0 1-4.08 6.18v5.14h6.61c3.86-3.56 6.08-8.8 6.08-14.82z" />
        <Path fill="#34A853" d="M24 44c5.5 0 10.1-1.82 13.53-4.72l-6.61-5.14C29.1 35.36 26.77 36.1 24 36.1c-5.32 0-9.83-3.6-11.44-8.44H5.73v5.3A20 20 0 0 0 24 44z" />
        <Path fill="#FBBC05" d="M12.56 27.66a12 12 0 0 1 0-7.32v-5.3H5.73a20 20 0 0 0 0 17.92z" />
        <Path fill="#EA4335" d="M24 11.9c3 0 5.68 1.03 7.8 3.05l5.85-5.85A19.58 19.58 0 0 0 24 4 20 20 0 0 0 5.73 15.04l6.83 5.3C14.17 15.5 18.68 11.9 24 11.9z" />
      </Svg>
      <Text style={styles.label}>Sign in with Google</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, backgroundColor: '#FFFFFF', borderColor: '#747775', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 16, marginTop: 12 },
  label: { color: '#1F1F1F', fontSize: 16, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
});
