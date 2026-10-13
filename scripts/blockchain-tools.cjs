const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { loadEnvFile } = require('node:process');
const {
  Contract,
  FetchRequest,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  formatEther,
  id,
  isAddress,
  ZeroHash,
} = require('ethers');

const root = path.resolve(__dirname, '..');
const contractsDirectory = path.join(root, 'packages/contracts');
const envPath = path.join(contractsDirectory, '.env');
if (fs.existsSync(envPath)) loadEnvFile(envPath);
const localWallet = HDNodeWallet.fromPhrase(
  'test test test test test test test test test test test junk',
);
const abi = [
  'function owner() view returns (address)',
  'function writers(address) view returns (bool)',
  'function exists(bytes32) view returns (bool)',
  'function getProof(bytes32) view returns (bytes32 recordHash, uint64 recordedAt, bytes32 transactionType, bytes32 verificationData, bool exists)',
  'function recordProof(bytes32,bytes32,bytes32,bytes32)',
  'function verifyProof(bytes32,bytes32)',
  'event TransactionProofVerified(bytes32 indexed referenceKey, bytes32 indexed recordHash, address indexed verifier, bool matches)',
];
class SetupError extends Error {}
function requireSetting(value, name) {
  if (!value?.trim())
    throw new SetupError(`Set ${name} in packages/contracts/.env before using Sepolia.`);
  return value.trim();
}
function resolveSettings(name) {
  if (!['local', 'sepolia'].includes(name)) throw new SetupError('Select local or sepolia.');
  const local = name === 'local';
  const rpc = local
    ? process.env.HARDHAT_RPC_URL || 'http://127.0.0.1:8545'
    : requireSetting(process.env.SEPOLIA_RPC_URL, 'SEPOLIA_RPC_URL');
  let url;
  try {
    url = new URL(rpc);
  } catch {
    throw new SetupError('The RPC URL must be a valid HTTP(S) address.');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new SetupError('The RPC URL must use HTTP(S).');
  if (local && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new SetupError('Local setup only accepts a localhost RPC address.');
  const key = local
    ? localWallet.privateKey
    : requireSetting(
        process.env.BLOCKCHAIN_PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY,
        'BLOCKCHAIN_PRIVATE_KEY or SEPOLIA_PRIVATE_KEY',
      );
  if (!/^0x[0-9a-fA-F]{64}$/.test(key))
    throw new SetupError(
      'The signing private key must contain 0x followed by 64 hexadecimal characters.',
    );
  if (!local && key.toLowerCase() === localWallet.privateKey.toLowerCase())
    throw new SetupError(
      'Use a dedicated Sepolia test wallet, rather than the public Hardhat development key.',
    );
  const manifestPath = path.join(
    contractsDirectory,
    'deployments',
    local ? 'localhost.json' : 'sepolia.json',
  );
  if (!fs.existsSync(manifestPath))
    throw new SetupError(`Deploy first: npm.cmd run chain:deploy:${name}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const chainId = local ? 31337 : 11155111;
  const address = manifest.contracts?.TransactionProofRegistry?.address;
  if (manifest.chainId !== chainId || !isAddress(address || ''))
    throw new SetupError('The deployment manifest has an invalid chain ID or contract address.');
  return { rpc, key, chainId, address, manifest };
}
async function connect(settings) {
  const rpcRequest = new FetchRequest(settings.rpc);
  rpcRequest.timeout = 10000;
  const provider = new JsonRpcProvider(rpcRequest, settings.chainId, { staticNetwork: true });
  provider.pollingInterval = 1000;
  try {
    const actualChain = Number(BigInt(await provider.send('eth_chainId', [])));
    if (actualChain !== settings.chainId)
      throw new SetupError('RPC chain ID does not match the selected network.');
    if ((await provider.getCode(settings.address)) === '0x')
      throw new SetupError(
        'No contract at the saved address. Restarted local nodes need a fresh deployment.',
      );
    const wallet = new Wallet(settings.key, provider);
    const contract = new Contract(settings.address, abi, wallet);
    if ((await contract.owner()).toLowerCase() !== settings.manifest.deployer.toLowerCase())
      throw new SetupError('Contract owner does not match the deployment manifest.');
    if (!(await contract.writers(wallet.address)))
      throw new SetupError(
        'The API wallet is not an authorized contract writer. Deploy with its API_WRITER_ADDRESS.',
      );
    return { provider, wallet, contract };
  } catch (error) {
    provider.destroy();
    throw error;
  }
}
function updateApiEnvironment(settings) {
  const apiEnv = path.join(root, 'apps/api/.env');
  const text = fs.existsSync(apiEnv)
    ? fs.readFileSync(apiEnv, 'utf8')
    : fs.readFileSync(path.join(root, 'apps/api/.env.example'), 'utf8');
  const updates = {
    BLOCKCHAIN_RPC_URL: settings.rpc,
    BLOCKCHAIN_PRIVATE_KEY: settings.key,
    CONTRACT_ADDRESS: settings.address,
  };
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${JSON.stringify(updates[match[1]])}`;
  });
  for (const [name, value] of Object.entries(updates))
    if (!seen.has(name)) lines.push(`${name}=${JSON.stringify(value)}`);
  if (fs.existsSync(apiEnv))
    fs.copyFileSync(
      apiEnv,
      `${apiEnv}.blockchain-backup-${Date.now()}`,
      fs.constants.COPYFILE_EXCL,
    );
  fs.writeFileSync(apiEnv, lines.join('\n'));
  console.log(
    'Updated only the three blockchain settings in apps/api/.env; existing settings were preserved. Restart the API to load them.',
  );
}
async function main() {
  const [command, name] = process.argv.slice(2);
  if (!['check', 'configure', 'smoke'].includes(command))
    throw new SetupError(
      'Usage: node scripts/blockchain-tools.cjs check|configure|smoke local|sepolia',
    );
  const settings = resolveSettings(name);
  const { provider, wallet, contract } = await connect(settings);
  try {
    const balance = await provider.getBalance(wallet.address);
    console.log(`Network: ${name}; chain ID: ${settings.chainId}`);
    console.log(`Proof registry: ${settings.address}`);
    console.log(
      `Authorized API wallet: ${wallet.address}; balance: ${formatEther(balance)} test ETH`,
    );
    if (command === 'configure') updateApiEnvironment(settings);
    if (command === 'smoke') {
      if (balance === 0n)
        throw new SetupError('Fund the signing wallet with test ETH before recording a proof.');
      // Synthetic data only; does not read or change financial database records.
      const reference = id(`RCM-SCRIPT-SMOKE-${randomUUID()}`);
      const recordHash = id('Synthetic microfinance proof test');
      const transaction = await contract.recordProof(
        reference,
        recordHash,
        id('TEST_PROOF'),
        ZeroHash,
      );
      const recorded = await transaction.wait(1, 180000);
      if (!recorded || recorded.status !== 1)
        throw new SetupError('The proof transaction did not confirm.');
      const proof = await contract.getProof(reference);
      if (!(await contract.exists(reference)) || proof.recordHash !== recordHash)
        throw new SetupError('Stored proof did not match the submitted hash.');
      const verification = await contract.verifyProof(reference, recordHash);
      const verified = await verification.wait(1, 180000);
      const event = verified?.logs
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((event) => event?.name === 'TransactionProofVerified');
      if (!event?.args.matches)
        throw new SetupError('The contract did not confirm a matching proof.');
      console.log(`Proof recorded: ${recorded.hash}`);
      console.log(`Proof verified: ${verified.hash}`);
      console.log('PASS: on-chain recording, reading, and verification agree.');
    }
  } finally {
    provider.destroy();
  }
}

if (require.main === module)
  main().catch((error) => {
    // Provider errors can contain RPC credentials; do not print raw errors.
    console.error(
      error instanceof SetupError
        ? error.message
        : 'Blockchain command failed. Check the RPC connection, deployment, wallet settings, and test ETH balance.',
    );
    process.exitCode = 1;
  });
module.exports = { resolveSettings, updateApiEnvironment };
