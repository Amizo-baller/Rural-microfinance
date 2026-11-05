import Constants, { ExecutionEnvironment } from 'expo-constants';

export async function googleIdToken(): Promise<string | null> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
    throw new Error('Open the installed Rural Microfinance Android app to sign in with Google.');
  const webClientId = Constants.expoConfig?.extra?.google?.webClientId;
  if (typeof webClientId !== 'string' || !webClientId.endsWith('.apps.googleusercontent.com'))
    throw new Error('Google sign-in is not configured.');
  const { GoogleOneTapSignIn, isSuccessResponse, isCancelledResponse } =
    await import('react-native-nitro-google-signin');
  await GoogleOneTapSignIn.configure({ webClientId });
  await GoogleOneTapSignIn.checkPlayServices();
  const response = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isCancelledResponse(response)) return null;
  if (!isSuccessResponse(response) || !response.data.idToken)
    throw new Error('Google could not complete sign-in. Please try again.');
  return response.data.idToken;
}
