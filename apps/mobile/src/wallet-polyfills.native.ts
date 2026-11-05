import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Loaded before the SDK, only in installed native builds.
const runtime = globalThis as unknown as {
  Buffer?: typeof Buffer;
  window?: {
    location?: { hostname: string; href: string };
    addEventListener?: () => void;
    removeEventListener?: () => void;
    dispatchEvent?: () => boolean;
  };
};
runtime.Buffer ??= Buffer;
runtime.window ??= {};
runtime.window.location ??= { hostname: 'localhost', href: 'http://localhost' };
runtime.window.addEventListener ??= () => undefined;
runtime.window.removeEventListener ??= () => undefined;
runtime.window.dispatchEvent ??= () => true;
