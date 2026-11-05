// MetaMask uses the native global WebSocket. Metro also walks its dynamic
// Node-only `import('ws')` fallback, so give that path the same native transport.
const NativeWebSocket = globalThis.WebSocket;
export { NativeWebSocket as WebSocket };
export default NativeWebSocket;
