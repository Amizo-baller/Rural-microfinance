import type { WalletProvider } from './metamask';

export function currentWalletProvider(): WalletProvider | undefined {
  if (typeof window === 'undefined') return;
  const provider = (window as unknown as { ethereum?: WalletProvider }).ethereum;
  return (
    provider?.providers?.find((item) => item.isMetaMask) ??
    (provider?.isMetaMask ? provider : undefined)
  );
}

export async function prepareWalletProvider() {
  return currentWalletProvider();
}

export async function connectWallet(forceRequest = false) {
  const provider = currentWalletProvider();
  if (!provider)
    throw new Error(
      'Open this page in MetaMask’s browser or install the MetaMask browser extension.',
    );
  if (forceRequest)
    await provider.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
  return { provider, accounts: await provider.request({ method: 'eth_requestAccounts' }) };
}

export async function endWalletConnection() {
  /* Injected permissions are revoked by the caller. */
}
