import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { dismissNotice, useNotice } from '../src/feedback';

export default function RootLayout() {
  const notice = useNotice();
  useEffect(() => {
    if (notice && Platform.OS !== 'web')
      AccessibilityInfo.announceForAccessibility(`${notice.title}. ${notice.message}`);
  }, [notice]);
  return (
    <SafeAreaProvider>
      <Head>
        <title>Rural Microfinance</title>
        <meta name="referrer" content="no-referrer" />
        <style>
          {
            '[role="button"]:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid #0F766E !important; outline-offset: 2px; }'
          }
        </style>
      </Head>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.root}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {notice && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.notice}
            >
              <ScrollView>
                <Text style={styles.title}>{notice.title}</Text>
                <Text style={styles.message}>{notice.message}</Text>
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss message"
                style={styles.dismiss}
                onPress={dismissNotice}
              >
                <Text style={styles.title}>Dismiss</Text>
              </Pressable>
            </View>
          )}
          <Stack screenOptions={{ headerShown: false }} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F0FDFA' },
  notice: {
    maxHeight: '40%',
    flexShrink: 1,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderColor: '#0F766E',
  },
  title: { color: '#0F766E', fontSize: 16, fontWeight: '700' },
  message: { color: '#334155', fontSize: 16, marginTop: 4 },
  dismiss: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
  },
});
