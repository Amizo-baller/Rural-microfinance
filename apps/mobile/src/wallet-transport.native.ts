import Constants from 'expo-constants';
import { AppState, Linking, Platform } from 'react-native';
import type { createEVMClient } from '@metamask/connect-evm';
import type { WalletProvider } from './metamask';
import { resolveApiUrl } from './api-config';

type Client = Awaited<ReturnType<typeof createEVMClient>>;
let clientPromise: Promise<Client> | undefined;
let provider: WalletProvider | undefined;
let disconnectPromise: Promise<void> | undefined;
const linkFailures = new Set<(error: Error) => void>();
const REQUEST_TIMEOUT_MS = 120_000;
export const currentWalletProvider = () => provider;

function closeClient(): Promise<void> {
  if (disconnectPromise) return disconnectPromise;
  if (!clientPromise) return Promise.resolve();
  disconnectPromise = clientPromise.then((client) => client.disconnect()).finally(() => {
    disconnectPromise = undefined;
  });
  return disconnectPromise;
}

async function withLinkErrors<T>(work: () => Promise<T>): Promise<T> {
  // Development diagnostics contain lifecycle/timing only, never wallet payloads.
  const started = Date.now();
  const trace = (event: string) => {
    if (typeof __DEV__ !== 'undefined' && __DEV__)
      console.info(`[wallet-transport] ${event} elapsedMs=${Date.now() - started}`);
  };
  trace('request-start');
  const lifecycle = AppState?.addEventListener('change', (state) => trace(`app-${state}`));
  let rejectLink: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_, reject) => {
    rejectLink = reject;
  });
  linkFailures.add(rejectLink);
  const timeout = setTimeout(() => {
    rejectLink(new Error('MetaMask did not respond. Unlock MetaMask, cancel any pending request, and reconnect.'));
    void closeClient().catch(() => undefined);
  }, REQUEST_TIMEOUT_MS);
  try {
    const result = await Promise.race([work(), failure]);
    trace('request-complete');
    return result;
  } catch (cause) {
    trace('request-failed');
    // The SDK transport can expire before our outer deadline. Close that stale
    // session too, so the next connection does not reuse an unanswered request.
    if (cause instanceof Error && /transport request timed out/i.test(cause.message)) {
      void closeClient().catch(() => undefined);
      throw new Error('The MetaMask connection timed out. Reconnect MetaMask, review the new request, then return to Rural Microfinance after confirming.');
    }
    throw cause;
  } finally {
    lifecycle?.remove();
    clearTimeout(timeout);
    linkFailures.delete(rejectLink);
  }
}

function getClient() {
  if (Constants.appOwnership === 'expo')
    throw new Error(
      'MetaMask login requires the installed Rural Microfinance APK or a development build. Expo Go cannot connect to MetaMask Mobile.',
    );
  if (!clientPromise) {
    clientPromise = (async () => {
      // Metro bundles these synchronously, but Expo Go must never evaluate them.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./wallet-polyfills.native');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createEVMClient } = require('@metamask/connect-evm') as typeof import('@metamask/connect-evm');
      const apiUrl = resolveApiUrl({
        platform: Platform.OS,
        configuredUrl: Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
        metroHost: Constants.expoConfig?.hostUri,
      });
      const url = new URL(process.env.EXPO_PUBLIC_WALLET_APP_URL || apiUrl).origin;
      const chainId = process.env.EXPO_PUBLIC_WALLET_CHAIN_ID || '0x1';
      const rpcUrl = process.env.EXPO_PUBLIC_WALLET_RPC_URL || 'https://cloudflare-eth.com';
      if (!/^0x[1-9a-fA-F][0-9a-fA-F]*$/.test(chainId))
        throw new Error('Configure a valid wallet chain ID in hexadecimal.');
      if (!['http:', 'https:'].includes(new URL(rpcUrl).protocol))
        throw new Error('Configure an HTTP(S) wallet RPC URL.');
      const client = await createEVMClient({
        dapp: { name: 'Rural Microfinance', url, nativeScheme: 'ruralmicrofinance://' },
        api: { supportedNetworks: { [chainId]: rpcUrl } },
        // Let the SDK choose its mobile deeplink path when no extension exists.
        ui: { preferExtension: true, headless: true },
        mobile: {
          preferredOpenLink: (deeplink: string) => {
            void Linking.openURL(deeplink).catch(() => {
              const error = new Error(
                'Could not open MetaMask Mobile. Install or unlock MetaMask and retry.',
              );
              for (const reject of linkFailures) reject(error);
              void closeClient().catch(() => undefined);
            });
          },
        },
        analytics: { enabled: false },
      });
      const raw = client.getProvider() as unknown as WalletProvider;
      provider = {
        request: (args) => withLinkErrors(() => raw.request(args)),
        on: (event, callback) => raw.on?.(event, callback),
        removeListener: (event, callback) => raw.removeListener?.(event, callback),
      };
      return client;
    })().catch((error: unknown) => {
      clientPromise = undefined;
      throw error;
    });
  }
  return clientPromise;
}

export async function prepareWalletProvider() {
  if (Constants.appOwnership === 'expo') return undefined;
  await getClient();
  return provider;
}

export async function connectWallet(forceRequest = false) {
  // A late disconnect must not tear down the next connection attempt.
  if (disconnectPromise) await disconnectPromise;
  const client = await getClient();
  const result = await withLinkErrors(() =>
    client.connect({
      chainIds: [(process.env.EXPO_PUBLIC_WALLET_CHAIN_ID || '0x1') as `0x${string}`],
      forceRequest,
    }),
  );
  return { provider: provider!, accounts: result.accounts };
}

export async function endWalletConnection() {
  for (const reject of linkFailures) reject(new Error('Wallet request cancelled. Reconnect to sign in.'));
  await closeClient();
}
