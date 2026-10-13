import { ConfigService } from '@nestjs/config';
import { Interface } from 'ethers';
import { BlockchainService } from './blockchain.service';
import { transactionProofRegistryAbi } from './transaction-proof.abi';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('blockchain receipt responses', () => {
  const value = '0x' + '1'.repeat(64);
  const abi = new Interface(transactionProofRegistryAbi);

  it('serializes a recorded-proof timestamp without losing integer precision', async () => {
    const service = new BlockchainService(
      new ConfigService(),
      {} as PrismaService,
      {} as NotificationsService,
    );
    const timestamp = 9007199254740993n;
    const log = abi.encodeEventLog(abi.getEvent('TransactionProofRecorded')!, [
      value,
      value,
      value,
      timestamp,
    ]);
    const receipt = { hash: value, blockNumber: 1, logs: [log] };
    Object.assign(service, {
      contract: {
        recordProof: jest.fn().mockResolvedValue({ wait: async () => receipt }),
        getAddress: async () => '0x' + '1'.repeat(40),
      },
      provider: { getNetwork: async () => ({ name: 'hardhat' }) },
    });
    const result = await service.recordProof({
      reference: value,
      recordHash: value,
      transactionType: value,
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.event?.args[3]).toBe(timestamp.toString());
  });

  it('preserves a negative proof-verification result in JSON', async () => {
    const service = new BlockchainService(
      new ConfigService(),
      {} as PrismaService,
      {} as NotificationsService,
    );
    const log = abi.encodeEventLog(abi.getEvent('TransactionProofVerified')!, [
      value,
      value,
      '0x' + '1'.repeat(40),
      false,
    ]);
    Object.assign(service, {
      contract: {
        verifyProof: jest
          .fn()
          .mockResolvedValue({ wait: async () => ({ hash: value, blockNumber: 2, logs: [log] }) }),
      },
    });
    const result = await service.verifyProof(value, value);
    expect(result.verified).toBe(false);
    expect(JSON.parse(JSON.stringify(result)).event.args[3]).toBe(false);
  });
});
