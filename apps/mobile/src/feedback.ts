import { useSyncExternalStore } from 'react';

type Notice = { title: string; message: string } | null;
let notice: Notice = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const Alert = {
  alert(title: string, message = '') {
    notice = { title, message };
    listeners.forEach((listener) => listener());
  },
};
export function dismissNotice() {
  notice = null;
  listeners.forEach((listener) => listener());
}
export function useNotice() {
  return useSyncExternalStore(
    subscribe,
    () => notice,
    () => null,
  );
}
