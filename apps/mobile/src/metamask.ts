import { Linking, Platform } from 'react-native';
import { connectWallet, currentWalletProvider } from './wallet-transport';
export { connectWallet, prepareWalletProvider, endWalletConnection } from './wallet-transport';

export type WalletProvider = {
  isMetaMask?: boolean;
  providers?: WalletProvider[];
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
};
let selectedAddress = '';
let generation = 0;
export const walletGeneration = () => generation;
export const selectedWallet = () => selectedAddress;
export function selectWallet(address: string) {
  if (selectedAddress !== address.toLowerCase()) {
    selectedAddress = address.toLowerCase();
    generation++;
  }
}
export function invalidateWalletRequest() {
  generation++;
}
export function metaMaskProvider(): WalletProvider | undefined {
  return currentWalletProvider();
}
export function walletAccounts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter(
          (address): address is string =>
            typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address),
        )
        .map((address) => address.toLowerCase()),
    ),
  ];
}

// Keep session identity tied to the active signing account on every app screen.
export function watchWalletSession(provider: WalletProvider, address: string, end: () => void) {
  let ended = false;
  const invalidate = () => {
    if (ended) return;
    ended = true;
    invalidateWalletRequest();
    end();
  };
  const changed = (...args: unknown[]) => {
    if (walletAccounts(args[0])[0] !== address.toLowerCase()) invalidate();
  };
  provider.on?.('accountsChanged', changed);
  provider.on?.('chainChanged', invalidate);
  provider.on?.('disconnect', invalidate);
  return () => {
    ended = true;
    provider.removeListener?.('accountsChanged', changed);
    provider.removeListener?.('chainChanged', invalidate);
    provider.removeListener?.('disconnect', invalidate);
  };
}
export async function chooseWalletAccounts(provider: WalletProvider) {
  if (Platform.OS !== 'web') return walletAccounts((await connectWallet(true)).accounts);
  try {
    await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== -32601 && code !== 4200) throw error;
    // Older mobile providers expose account access but not the permission picker.
    // Their own account menu still controls the active signing address.
    return walletAccounts(await provider.request({ method: 'eth_requestAccounts' }));
  }
  return walletAccounts(await provider.request({ method: 'eth_accounts' }));
}
export async function disconnectWalletAccounts(provider: WalletProvider) {
  invalidateWalletRequest();
  selectWallet('');
  await provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
}
export async function walletSignature(provider: WalletProvider, message: string, address: string) {
  const bytes = new TextEncoder().encode(message);
  const data =
    '0x' +
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const signature = await provider.request({ method: 'personal_sign', params: [data, address] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new Error('MetaMask did not return a valid signature.');
  return signature;
}
export function walletAppUrl(configured?: string, metroHost?: string, webOrigin?: string) {
  const url = new URL(
    configured || webOrigin || (metroHost ? `http://${metroHost}` : 'http://localhost:8084'),
  );
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Configure the wallet app web address.');
  url.pathname = '/';
  url.search = '?signIn=1';
  url.hash = '';
  return url.toString();
}
export async function openWalletBrowser(url: string) {
  const target = url.startsWith('https://') ? url.slice(8) : url;
  await Linking.openURL(`https://link.metamask.io/dapp/${target}`);
}

export const METAMASK_HOME_URL = 'https://link.metamask.io/home';

// App launch only. A wallet must sign a server challenge before it can authenticate.
export async function openMetaMask() {
  if (Platform.OS !== 'web') {
    try {
      // Open directly: Android package visibility can make canOpenURL inaccurate in Expo Go.
      await Linking.openURL('metamask://');
      return;
    } catch {
      // Universal link also supports installing MetaMask when it is unavailable.
    }
  }
  try {
    await Linking.openURL(METAMASK_HOME_URL);
  } catch {
    throw new Error(
      'Could not open MetaMask. Open the MetaMask app directly, or install it from metamask.io/download.',
    );
  }
}
