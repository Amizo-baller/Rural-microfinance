import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { request } from './api-client';
import {
  chooseWalletAccounts,
  connectWallet,
  prepareWalletProvider,
  endWalletConnection,
  disconnectWalletAccounts,
  invalidateWalletRequest,
  metaMaskProvider,
  openWalletBrowser,
  selectedWallet,
  selectWallet,
  walletAccounts,
  walletAppUrl,
  walletGeneration,
  walletSignature,
  watchWalletSession,
} from './metamask';
import type { WalletProvider } from './metamask';

export type WalletSession = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    memberId: string;
    email: string | null;
    phone: string | null;
    role: string;
    walletAddress?: string;
  };
};

export function useWalletSessionGuard(address: string | undefined, onEndSession: () => Promise<void>) {
  const callback = useRef(onEndSession);
  callback.current = onEndSession;
  useEffect(() => {
    if (!address) return;
    let live = true;
    let stop: (() => void) | undefined;
    const end = () => { if (live) void callback.current(); };
    void prepareWalletProvider().then(async (provider) => {
      if (!live) return;
      if (!provider) { end(); return; }
      stop = watchWalletSession(provider, address, end);
      const accounts = walletAccounts(await provider.request({ method: 'eth_accounts' }));
      if (live && accounts[0] !== address.toLowerCase()) end();
    }).catch(end);
    return () => { live = false; stop?.(); };
  }, [address]);
}

export function WalletAuth({
  onSession,
  onEndSession,
  onBusyChange,
  sessionWallet,
  linkToken,
  linkedAddress,
  disabled = false,
}: {
  onSession?: (session: WalletSession, isCurrent?: () => boolean) => Promise<void>;
  onEndSession?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  sessionWallet?: string;
  linkToken?: string;
  linkedAddress?: string | null;
  disabled?: boolean;
}) {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selected, setSelected] = useState(selectedWallet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState(false);
  const mounted = useRef(true);
  const operation = useRef<number | null>(null);
  const serial = useRef(0);
  const [disconnecting, setDisconnecting] = useState(false);
  const callbacks = useRef({ onEndSession, sessionWallet });
  callbacks.current = { onEndSession, sessionWallet };
  function updateAccounts(value: unknown) {
    const next = walletAccounts(value);
    setAccounts(next);
    const active = next.includes(selectedWallet()) ? selectedWallet() : (next[0] ?? '');
    selectWallet(active);
    setSelected(active);
  }
  useEffect(() => {
    mounted.current = true;
    let provider: WalletProvider | undefined;
    let live = true;
    const changed = (...args: unknown[]) => {
      invalidateWalletRequest();
      selectWallet(walletAccounts(args[0])[0] ?? '');
      updateAccounts(args[0]);
      const active = walletAccounts(args[0])[0];
      if (
        callbacks.current.sessionWallet &&
        active !== callbacks.current.sessionWallet.toLowerCase()
      )
        void callbacks.current.onEndSession?.();
    };
    const disconnected = () => changed([]);
    const chainChanged = () => {
      invalidateWalletRequest();
      if (callbacks.current.sessionWallet) void callbacks.current.onEndSession?.();
    };
    void prepareWalletProvider()
      .then(async (ready) => {
        if (!live) return;
        provider = ready;
        if (!provider) return;
        provider.on?.('accountsChanged', changed);
        provider.on?.('disconnect', disconnected);
        provider.on?.('chainChanged', chainChanged);
        const initialGeneration = walletGeneration();
        const value = await provider.request({ method: 'eth_accounts' });
        if (!live || initialGeneration !== walletGeneration()) return;
        updateAccounts(value);
        if (
          callbacks.current.sessionWallet &&
          selectedWallet() !== callbacks.current.sessionWallet.toLowerCase()
        )
          void callbacks.current.onEndSession?.();
      })
      .catch((cause: unknown) => {
        if (live)
          setError(
            cause instanceof Error ? cause.message : 'Could not restore the wallet connection.',
          );
      });
    return () => {
      live = false;
      mounted.current = false;
      provider?.removeListener?.('accountsChanged', changed);
      provider?.removeListener?.('disconnect', disconnected);
      provider?.removeListener?.('chainChanged', chainChanged);
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (operation.current !== null || disabled || disconnecting) return;
    const id = ++serial.current;
    operation.current = id;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (mounted.current && operation.current === id) {
        const failure = cause as { code?: number; rpcCode?: number };
        const code = failure?.rpcCode ?? failure?.code;
        setError(
          code === 4001
            ? 'Request cancelled. You can select an account and retry.'
            : code === -32002
              ? 'A MetaMask request is already open. Complete or cancel it in MetaMask first.'
              : cause instanceof Error
                ? cause.message
                : 'Could not complete the wallet request.',
        );
      }
    } finally {
      if (operation.current === id) {
        operation.current = null;
        onBusyChange?.(false);
        if (mounted.current) setBusy(false);
      }
    }
  }
  async function connect() {
    const activeOperation = operation.current;
    const provider = metaMaskProvider();
    if (!provider && Platform.OS === 'web') {
      const origin =
        Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
      await openWalletBrowser(
        walletAppUrl(process.env.EXPO_PUBLIC_WALLET_APP_URL, Constants.expoConfig?.hostUri, origin),
      );
      setNotice('Continue in the MetaMask browser. Choose Connect MetaMask there to sign in.');
      return;
    }
    // Every sign-in connection authenticates; linking keeps the explicit account picker.
    const wasConnected = accounts.length > 0 && !!provider;
    const connection =
      wasConnected && provider
        ? { provider, accounts: await chooseWalletAccounts(provider) }
        : await connectWallet();
    const next = walletAccounts(connection.accounts);
    if (!mounted.current || operation.current !== activeOperation) return;
    if (!next.length)
      throw new Error('No wallet account was shared. Connect an account in MetaMask and retry.');
    selectWallet(next[0] ?? '');
    updateAccounts(next);
    if (!linkToken && !sessionWallet) await sign(connection.provider, next[0]);
    else setPicker(true);
  }
  async function sign(provider = metaMaskProvider(), address = selected) {
    if (!provider || !address) throw new Error('Connect MetaMask and select an account first.');
    const start = walletGeneration();
    const assertCurrent = async () => {
      if (!mounted.current || start !== walletGeneration() || selectedWallet() !== address)
        throw new Error('Wallet account changed. Select the account and sign again.');
      const current = walletAccounts(await provider.request({ method: 'eth_accounts' }));
      if (!current.includes(address))
        throw new Error('This account is no longer connected. Select an account again.');
    };
    await assertCurrent();
    const chain = await provider.request({ method: 'eth_chainId' });
    if (typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain))
      throw new Error('MetaMask did not return a valid network.');
    const base = linkToken ? '/auth/wallet/link' : '/auth/wallet';
    const { message } = await request<{ message: string }>(`${base}/challenge`, {
      token: linkToken,
      body: { address, chainId: BigInt(chain).toString() },
    });
    await assertCurrent();
    const signature = await walletSignature(provider, message, address);
    await assertCurrent();
    if ((await provider.request({ method: 'eth_chainId' })) !== chain)
      throw new Error('Network changed. Sign again on the selected network.');
    if (linkToken) {
      await request('/auth/wallet/link', {
        token: linkToken,
        body: { address, message, signature },
      });
      if (mounted.current) setNotice(`Wallet linked: ${address}`);
    } else {
      const session = await request<WalletSession>('/auth/wallet/login', {
        body: { address, message, signature },
      });
      try {
        await assertCurrent();
        if (!onSession) throw new Error('Wallet login is unavailable on this screen.');
        await onSession(
          session,
          () => mounted.current && start === walletGeneration() && selectedWallet() === address,
        );
      } catch (cause) {
        await request('/auth/logout', { body: { refreshToken: session.refreshToken } }).catch(
          () => undefined,
        );
        throw cause;
      }
    }
  }
  async function disconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    operation.current = null;
    setBusy(false);
    onBusyChange?.(false);
    invalidateWalletRequest();
    selectWallet('');
    setAccounts([]);
    setSelected('');
    setPicker(false);
    // End only a wallet-authenticated app session; Google/password sessions are separate.
    try {
      if (sessionWallet) await onEndSession?.();
      const provider = metaMaskProvider();
      try {
        if (provider) await disconnectWalletAccounts(provider);
      } finally {
        await endWalletConnection();
      }
      if (mounted.current)
        setNotice(
          provider
            ? 'All wallet accounts disconnected from this app.'
            : 'No wallet is connected in this app view. Open the app in MetaMask to disconnect its browser connection there.',
        );
    } catch {
      if (mounted.current)
        setError(
          'App wallet session cleared. MetaMask did not revoke access; open MetaMask Connected sites and disconnect this site there.',
        );
    } finally {
      if (mounted.current) setDisconnecting(false);
    }
  }
  function button(label: string, work: () => void, extraDisabled = false) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={busy || disabled || disconnecting || extraDisabled}
        onPress={work}
        style={[
          styles.button,
          (busy || disabled || disconnecting || extraDisabled) && styles.disabled,
        ]}
      >
        <Text style={styles.label}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>
        MetaMask wallet
      </Text>
      {linkedAddress && <Text style={styles.text}>Linked wallet: {linkedAddress}</Text>}
      <Text style={styles.text}>
        {selected ? `Selected wallet: ${selected}` : 'No wallet account selected'}
      </Text>
      {button(
        accounts.length ? 'Choose accounts in MetaMask' : 'Connect MetaMask',
        () => void run(connect),
      )}
      {accounts.length > 0 && button('Select connected account', () => setPicker(!picker))}
      <Modal
        visible={picker}
        transparent
        animationType="none"
        onRequestClose={() => setPicker(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text accessibilityRole="header" style={styles.title}>
              Select connected account
            </Text>
            <ScrollView style={styles.accountList} keyboardShouldPersistTaps="handled">
              <View accessibilityRole="radiogroup" accessibilityLabel="Connected wallet accounts">
                {accounts.map((address, index) => (
                  <Pressable
                    key={address}
                    accessibilityRole="radio"
                    accessibilityLabel={`Wallet ${index + 1}: ${address}`}
                    accessibilityState={{ checked: selected === address }}
                    disabled={busy}
                    onPress={() => {
                      invalidateWalletRequest();
                      selectWallet(address);
                      setSelected(address);
                      setPicker(false);
                      if (sessionWallet && sessionWallet !== address) void onEndSession?.();
                    }}
                    style={styles.button}
                  >
                    <Text style={styles.text}>
                      {index + 1}. {address}
                      {selected === address ? ' · Selected' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            {button('Close account picker', () => setPicker(false))}
          </View>
        </View>
      </Modal>
      {!sessionWallet &&
        button(
          linkToken ? 'Link selected wallet' : 'Sign in with selected wallet',
          () => void run(() => sign()),
          !selected,
        )}
      <Pressable
        accessibilityRole="button"
        disabled={disconnecting}
        onPress={() => void disconnect()}
        style={styles.button}
      >
        <Text style={styles.label}>Disconnect all wallets</Text>
      </Pressable>
      {busy && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          Complete the request in MetaMask…
        </Text>
      )}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {notice && (
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {notice}
        </Text>
      )}
      <Text style={styles.text}>
        Only accounts you share in MetaMask appear here. Select another account there to change the
        signing account.
      </Text>
      {Platform.OS !== 'web' && (
        <Text style={styles.text}>
          Approve the connection and sign-in message in MetaMask, then return here. Your assigned
          account role determines your dashboard.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    marginVertical: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: '#172033' },
  text: { color: '#334155', fontSize: 14 },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#64748B',
    borderRadius: 8,
    marginVertical: 3,
  },
  label: { color: '#006B4E', fontWeight: '600' },
  disabled: { opacity: 0.5 },
  error: { color: '#9F1239' },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.5)',
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    width: '94%',
    maxWidth: 520,
    maxHeight: '80%',
  },
  accountList: { maxHeight: 380, marginVertical: 10 },
});
