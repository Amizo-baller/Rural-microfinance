import { Linking, Platform } from 'react-native';

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
