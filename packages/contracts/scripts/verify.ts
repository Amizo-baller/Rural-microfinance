import hre from 'hardhat';
import { verifyContract } from '@nomicfoundation/hardhat-verify/verify';
import { readFileSync } from 'node:fs';

async function main() {
  const connection = await hre.network.getOrCreate();
  if (
    connection.networkName !== 'sepolia' ||
    (await connection.ethers.provider.getNetwork()).chainId !== 11155111n
  )
    throw new Error('Explorer verification requires Sepolia.');
  const manifest = JSON.parse(
    readFileSync(new URL('../deployments/sepolia.json', import.meta.url), 'utf8'),
  );
  if (manifest.chainId !== 11155111) throw new Error('The deployment manifest is not for Sepolia.');
  for (const name of ['DeploymentRegistry', 'TransactionProofRegistry']) {
    const address = manifest.contracts[name].address;
    if ((await connection.ethers.provider.getCode(address)) === '0x')
      throw new Error('No deployed contract at the saved address.');
    await verifyContract(
      {
        address,
        contract: `contracts/${name}.sol:${name}`,
        constructorArgs: [],
        provider: 'etherscan',
      },
      hre,
    );
    console.log(`Verified ${name}: https://sepolia.etherscan.io/address/${address}#code`);
  }
}

main().catch(() => {
  console.error(
    'Explorer verification failed. Check the deployment manifest, ETHERSCAN_API_KEY, RPC connection, and explorer indexing; then retry.',
  );
  process.exitCode = 1;
});
