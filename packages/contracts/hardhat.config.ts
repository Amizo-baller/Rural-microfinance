import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import { configVariable, defineConfig } from 'hardhat/config';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: { version: '0.8.28', settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: { sources: './contracts', tests: './test', cache: './cache', artifacts: './artifacts' },
  networks: {
    hardhat: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 },
    localhost: {
      type: 'http',
      chainType: 'l1',
      chainId: 31337,
      url: process.env.HARDHAT_RPC_URL ?? 'http://127.0.0.1:8545',
    },
    sepolia: {
      type: 'http',
      chainType: 'l1',
      chainId: 11155111,
      url: configVariable('SEPOLIA_RPC_URL'),
      accounts: [configVariable('SEPOLIA_PRIVATE_KEY')],
    },
  },
  verify: { etherscan: { apiKey: configVariable('ETHERSCAN_API_KEY') } },
});
