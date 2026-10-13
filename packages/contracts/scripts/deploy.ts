import { network } from 'hardhat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

async function main() {
  const connection = await network.getOrCreate();
  const { ethers } = connection;
  const chain = await ethers.provider.getNetwork();
  const expected =
    connection.networkName === 'localhost'
      ? 31337n
      : connection.networkName === 'sepolia'
        ? 11155111n
        : undefined;
  if (!expected || chain.chainId !== expected)
    throw new Error('Use localhost or Sepolia with the matching chain ID.');
  const [deployer] = await ethers.getSigners();
  if ((await ethers.provider.getBalance(deployer.address)) === 0n)
    throw new Error('The deployment wallet needs test ETH.');
  const writer = process.env.API_WRITER_ADDRESS?.trim();
  if (writer && !ethers.isAddress(writer))
    throw new Error('API_WRITER_ADDRESS must be an Ethereum address.');
  console.log(`Deploying to ${connection.networkName} (${chain.chainId}) with ${deployer.address}`);
  const registry = await ethers.deployContract('DeploymentRegistry');
  await registry.waitForDeployment();
  console.log(`DeploymentRegistry: ${await registry.getAddress()}`);
  const proofRegistry = await ethers.deployContract('TransactionProofRegistry');
  await proofRegistry.waitForDeployment();
  console.log(`TransactionProofRegistry: ${await proofRegistry.getAddress()}`);
  if (writer && writer.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await proofRegistry.setWriter(writer, true)).wait();
    console.log(`Authorized API writer: ${writer}`);
  }
  const directory = fileURLToPath(new URL('../deployments/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  const output = `${directory}/${connection.networkName}.json`;
  const manifest = {
    network: connection.networkName,
    chainId: Number(chain.chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    writer: writer || deployer.address,
    contracts: {
      DeploymentRegistry: {
        address: await registry.getAddress(),
        transactionHash: registry.deploymentTransaction()?.hash,
      },
      TransactionProofRegistry: {
        address: await proofRegistry.getAddress(),
        transactionHash: proofRegistry.deploymentTransaction()?.hash,
      },
    },
  };
  // Preserve an existing deployment record when deploying again.
  writeFileSync(
    `${directory}/${connection.networkName}-${Date.now()}.json`,
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Deployment saved: ${output}`);
}

main().catch(() => {
  console.error(
    'Deployment failed. Check the selected network, test ETH balance, RPC connection, and wallet configuration.',
  );
  process.exitCode = 1;
});
