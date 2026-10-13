import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { clearTokens, request } from '../src/api-client';
import { Alert } from '../src/feedback';

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const resetToken = typeof token === 'string' ? token : '';

  async function reset() {
    if (submitting) return;
    if (!resetToken)
      return setError('This reset link is incomplete. Request a new link from Forgot password.');
    if (password.length < 8 || !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password))
      return setError('Use at least 8 characters, including uppercase, lowercase, and a number.');
    if (password !== confirmation) return setError('Enter the same password in both fields.');
    setError('');
    setSubmitting(true);
    try {
      await request('/auth/reset-password', { body: { token: resetToken, password } });
      await clearTokens();
      setPassword('');
      setConfirmation('');
      Alert.alert('Password changed', 'Sign in with your new password.');
      router.replace('/?signIn=1');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not reset your password. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.brand}>Rural Microfinance</Text>
      <Text accessibilityRole="header" aria-level={1} style={styles.title}>
        Choose a new password
      </Text>
      <Text style={styles.detail}>
        Use a password you can remember. Include a capital letter, a small letter, and a number.
      </Text>
      <View style={styles.field}>
        <Text style={styles.label}>New password</Text>
        <TextInput
          accessibilityLabel="New password"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          textContentType="newPassword"
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          accessibilityLabel="Confirm new password"
          style={styles.input}
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!submitting}
          textContentType="newPassword"
        />
      </View>
      {(error || !resetToken) && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
          {error || 'This reset link is incomplete. Request a new link from Forgot password.'}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting || !resetToken }}
        disabled={submitting || !resetToken}
        onPress={() => void reset()}
        style={[styles.button, (submitting || !resetToken) && styles.disabled]}
      >
        {submitting ? (
          <ActivityIndicator accessibilityLabel="Changing password" color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Change password</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={submitting}
        onPress={() => router.replace('/?signIn=1')}
        style={styles.back}
      >
        <Text style={styles.brand}>Back to sign in</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: 24,
    backgroundColor: '#F0FDFA',
  },
  brand: { color: '#0F766E', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  title: { color: '#172033', fontSize: 28, fontWeight: '700', marginBottom: 24 },
  detail: { color: '#475569', fontSize: 16, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { color: '#334155', fontSize: 16, marginBottom: 8 },
  input: {
    minHeight: 48,
    fontSize: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 6,
    color: '#172033',
    backgroundColor: '#FFFFFF',
  },
  error: { color: '#B91C1C', fontSize: 16, marginBottom: 16 },
  button: {
    minHeight: 48,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#0F766E',
  },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.65 },
  back: { minHeight: 48, paddingVertical: 16, alignItems: 'center' },
});
