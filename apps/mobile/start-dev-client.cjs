// MetaMask Connect loads parts of its React Native transport asynchronously.
// Metro's lazy dev bundles can omit those chunks from a native dev-client session.
process.env.EXPO_NO_METRO_LAZY = '1';
require('expo/bin/cli');
