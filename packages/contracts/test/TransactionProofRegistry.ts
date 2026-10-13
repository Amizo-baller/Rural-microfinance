import { expect } from 'chai';
import { network } from 'hardhat';
import { anyValue } from '@nomicfoundation/hardhat-ethers-chai-matchers/withArgs';
import type { TransactionProofRegistry } from '../typechain-types/index.js';

const { ethers } = await network.getOrCreate('hardhat');

describe('TransactionProofRegistry', () => {
  async function fixture() {
    const [owner, writer, outsider] = await ethers.getSigners();
    const registry = (await ethers.deployContract(
      'TransactionProofRegistry',
    )) as unknown as TransactionProofRegistry;
    await registry.waitForDeployment();
    return { registry, owner, writer, outsider };
  }

  it('records and retrieves a proof without storing sensitive data', async () => {
    const { registry } = await fixture();
    const reference = ethers.id('CONTR-001');
    const recordHash = ethers.keccak256(ethers.toUtf8Bytes('off-chain-record'));
    const type = ethers.id('CONTRIBUTION');
    const verificationData = ethers.id('GHS-100');

    await expect(registry.recordProof(reference, recordHash, type, verificationData))
      .to.emit(registry, 'TransactionProofRecorded')
      .withArgs(reference, recordHash, type, anyValue);

    expect(await registry.exists(reference)).to.equal(true);
    const proof = await registry.getProof(reference);
    expect(proof.recordHash).to.equal(recordHash);
    expect(proof.transactionType).to.equal(type);
    expect(proof.verificationData).to.equal(verificationData);
  });

  it('rejects duplicate references and unauthorized writes', async () => {
    const { registry, outsider } = await fixture();
    const reference = ethers.id('LOAN-001');
    const hash = ethers.keccak256(ethers.toUtf8Bytes('record'));
    await registry.recordProof(reference, hash, ethers.id('LOAN_REPAYMENT'), ethers.ZeroHash);
    await expect(
      registry.recordProof(reference, hash, ethers.id('LOAN_REPAYMENT'), ethers.ZeroHash),
    ).to.be.revertedWithCustomError(registry, 'DuplicateReference');
    await expect(
      registry
        .connect(outsider)
        .recordProof(ethers.id('OTHER'), hash, ethers.id('OTHER'), ethers.ZeroHash),
    ).to.be.revertedWithCustomError(registry, 'NotWriter');
  });

  it('allows the owner to authorize writers and emits verification events', async () => {
    const { registry, writer } = await fixture();
    await expect(registry.setWriter(writer.address, true))
      .to.emit(registry, 'WriterUpdated')
      .withArgs(writer.address, true);
    const reference = ethers.id('SAVINGS-001');
    const hash = ethers.keccak256(ethers.toUtf8Bytes('savings-record'));
    await registry
      .connect(writer)
      .recordProof(reference, hash, ethers.id('SAVINGS'), ethers.ZeroHash);
    await expect(registry.verifyProof(reference, hash))
      .to.emit(registry, 'TransactionProofVerified')
      .withArgs(reference, hash, (await ethers.getSigners())[0].address, true);
    await expect(registry.verifyProof(reference, ethers.ZeroHash))
      .to.emit(registry, 'TransactionProofVerified')
      .withArgs(reference, hash, (await ethers.getSigners())[0].address, false);
  });

  it('rejects unknown references', async () => {
    const { registry } = await fixture();
    const reference = ethers.id('MISSING');
    expect(await registry.exists(reference)).to.equal(false);
    await expect(registry.getProof(reference)).to.be.revertedWithCustomError(
      registry,
      'UnknownReference',
    );
    await expect(registry.verifyProof(reference, ethers.ZeroHash)).to.be.revertedWithCustomError(
      registry,
      'UnknownReference',
    );
  });
});
