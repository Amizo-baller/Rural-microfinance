# Blockchain setup: Hardhat locally and Ethereum Sepolia

Run every command below from the project root in PowerShell. The contracts and existing API endpoints are unchanged. The deployment and setup tools support only the local chain (31337) and Sepolia (11155111).

## 1. Prepare and test

```powershell
npm.cmd install
if (-not (Test-Path packages/contracts/.env)) {
  Copy-Item packages/contracts/.env.example packages/contracts/.env
}
npm.cmd run chain:compile
npm.cmd run chain:test
npm.cmd run chain:typecheck
```

The setup already creates a contracts .env file when needed. Keep your existing file if it contains settings. Hardhat loads packages/contracts/.env; shell environment variables take precedence. The backend loads apps/api/.env. Neither private keys nor RPC credentials are saved in deployment manifests or printed by the setup helper.

## 2. Start the local blockchain

In terminal 1:

```powershell
npm.cmd run chain
```

Leave this terminal running. The node listens at http://127.0.0.1:8545, chain ID 31337. Its built-in accounts have development ETH. The API connects to it on the computer; your phone accesses the blockchain through the API.

## 3. Deploy and connect the backend locally

In terminal 2:

```powershell
npm.cmd run chain:setup:local
npm.cmd run chain:smoke:local
npm.cmd run dev:api
```

The setup command deploys both registries, saves their addresses, updates only BLOCKCHAIN_RPC_URL, BLOCKCHAIN_PRIVATE_KEY, and CONTRACT_ADDRESS in apps/api/.env, and checks the connection. It backs up an existing API .env before changing those keys. CONTRACT_ADDRESS is the TransactionProofRegistry address, not DeploymentRegistry.

Local configuration uses Hardhat's first public development account. The smoke test records a synthetic proof and verifies it on-chain; it does not change savings, loans, or financial database records. Repeated smoke tests use unique references.

If the API is already running, stop and restart it after configuration. Your PostgreSQL/database configuration is preserved. This setup does not provision a PostgreSQL server.

These commands are also available separately:

```powershell
npm.cmd run chain:deploy:local
npm.cmd run chain:configure:local
npm.cmd run chain:check:local
npm.cmd run chain:smoke:local
```

A restarted Hardhat node has a fresh blockchain. Run chain:setup:local again and restart the API. Previously stored database transaction hashes refer to the old local chain; verification needs a new proof on the new chain. Each deployment preserves a timestamped manifest as well as the latest manifest in packages/contracts/deployments.

## 4. Prepare Sepolia

Edit packages/contracts/.env locally:

```dotenv
SEPOLIA_RPC_URL=https://your-sepolia-rpc-endpoint
SEPOLIA_PRIVATE_KEY=0xYOUR_DEDICATED_TEST_WALLET_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
API_WRITER_ADDRESS=
BLOCKCHAIN_PRIVATE_KEY=
```

Replace the example values with your own. Use a dedicated test wallet and fund its public address with Sepolia test ETH from a faucet. Keep private keys in the ignored .env file and do not send them in chat. Sepolia's chain ID is 11155111. Ethereum's [network guide](https://ethereum.org/developers/docs/networks/) lists Sepolia faucets and explorers.

By default, the deployment wallet also signs the backend's proof transactions. For a separate backend test wallet, set BLOCKCHAIN_PRIVATE_KEY to that wallet's private key and API_WRITER_ADDRESS to its public address before deploying. Fund both wallets with test ETH. Deployment authorizes the specified writer; configuration checks that the backend wallet actually has writer permission.

## 5. Deploy, verify, and connect Sepolia

```powershell
npm.cmd run chain:deploy:sepolia
npm.cmd run chain:check:sepolia
npm.cmd run chain:verify:sepolia
npm.cmd run chain:configure:sepolia
npm.cmd run chain:smoke:sepolia
npm.cmd run dev:api
```

Deploy runs real Sepolia test transactions. Check is read-only. Explorer verification publishes the existing Solidity source for the saved deployment and needs ETHERSCAN_API_KEY; it does not change the deployed contract. If the explorer has not indexed a new deployment yet, retry verification later. The verify command explicitly uses the same default build profile as deployment.

Configure switches the existing backend to the saved Sepolia proof registry after checking the chain, contract owner, and writer authorization. Restart an already-running API. Smoke submits synthetic proof and verification transactions using test ETH. No financial logic is changed, and public deployment still requires your own RPC credentials and funded test wallet.

## 6. Verify a financial record through the existing API

With the API running and its blockchain settings configured, obtain the ID of an existing financial transaction from your transaction details or the authenticated GET /api/financial-records endpoint. Then run:

```powershell
npm.cmd run chain:api:test -- -TransactionId YOUR_TRANSACTION_UUID
```

The script prompts for your administrator email/phone and a masked password. It checks blockchain status, obtains the existing database hash, records a proof if verification is pending, and confirms VERIFIED through the existing API. A differing existing proof is not overwritten. It uses the financial record's actual transaction type and revokes the script's own login session afterwards.

This script deliberately records a proof for the selected existing record on the configured blockchain. It does not create a savings contribution or loan repayment. Backend verification may create its existing verification notification.

The underlying routes are:

| Purpose                                   | Existing endpoint                             |
| ----------------------------------------- | --------------------------------------------- |
| Configuration status                      | GET /api/blockchain/status                    |
| Compare a financial record with its proof | GET /api/blockchain/verify/:transactionId     |
| Record a proof                            | POST /api/blockchain/proofs                   |
| Emit a proof verification transaction     | POST /api/blockchain/proofs/:reference/verify |

The deployment scripts follow [Hardhat 3 network configuration](https://hardhat.org/docs/reference/configuration) and [script deployment guidance](https://hardhat.org/docs/guides/deployment/using-scripts).

## Validation on 2026-10-09

Both Solidity contracts compiled, all four contract tests passed, and the contracts TypeScript checks passed. Local deployment, writer/owner checks, API environment configuration, and on-chain proof recording/reading/verification passed. The existing non-blockchain backend settings were checked against the automatic backup and were preserved. The Node helper and PowerShell API script passed syntax checks. The API proof script requires your login and a chosen financial transaction ID to run its authenticated check.

Sepolia configuration and scripts are prepared, but no public deployment was attempted because the RPC URL and test-wallet credentials have not been supplied. Fill those settings locally and use the Sepolia commands above.

The development API was restarted after local configuration and its health endpoint returned HTTP 200 with status ok. The local node remains running on port 8545.
