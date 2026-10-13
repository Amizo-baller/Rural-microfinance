import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, Interface, JsonRpcProvider, Log, LogDescription, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { PrismaService } from '../prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { transactionProofRegistryAbi } from './transaction-proof.abi';

export type ProofInput = {
  reference: string;
  recordHash: string;
  transactionType: string;
  verificationData?: string;
};

@Injectable()
export class BlockchainService {
  private readonly provider?: JsonRpcProvider;
  private readonly wallet?: Wallet;
  private readonly contract?: Contract;
  private readonly contractInterface = new Interface(transactionProofRegistryAbi);
  private readonly network?: string;

  constructor(config: ConfigService, private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {
    const rpcUrl = config.get<string>('BLOCKCHAIN_RPC_URL')?.trim();
    const privateKey = config.get<string>('BLOCKCHAIN_PRIVATE_KEY')?.trim();
    const contractAddress = config.get<string>('CONTRACT_ADDRESS')?.trim();
    if (!rpcUrl || !privateKey || !contractAddress) return;
    try {
      this.provider = new JsonRpcProvider(rpcUrl);
      this.wallet = new Wallet(privateKey, this.provider);
      this.contract = new Contract(contractAddress, transactionProofRegistryAbi, this.wallet);
    } catch {
      throw new ServiceUnavailableException('Blockchain configuration is invalid');
    }
  }

  configured() { return Boolean(this.provider && this.wallet && this.contract); }

  async attest(reference: string, recordHash: string, transactionType: string) {
    if (!this.contract || !this.provider) throw new ServiceUnavailableException('Blockchain integration is not configured');
    const key = this.toBytes32(reference);
    if (await this.contract.exists(key)) {
      const proof = await this.contract.getProof(key);
      if (String(proof.recordHash).toLowerCase() !== recordHash.toLowerCase()) throw new ServiceUnavailableException('Existing blockchain proof does not match this record');
      return { verified: true, transactionHash: null as string | null };
    }
    const receipt = await this.recordProof({ reference, recordHash, transactionType });
    const proof = await this.contract.getProof(key);
    if (String(proof.recordHash).toLowerCase() !== recordHash.toLowerCase()) throw new ServiceUnavailableException('Blockchain proof verification failed');
    return { verified: true, transactionHash: receipt.transactionHash };
  }

  async recordProof(input: ProofInput) {
    if (!this.contract || !this.provider) throw new ServiceUnavailableException('Blockchain integration is not configured');
    const reference = this.toBytes32(input.reference);
    const recordHash = this.toBytes32(input.recordHash);
    const transactionType = this.toBytes32(input.transactionType);
    const verificationData = this.toBytes32(input.verificationData ?? '');
    try {
      const response = await this.contract.recordProof(reference, recordHash, transactionType, verificationData);
      const receipt = await response.wait();
      if (!receipt) throw new ServiceUnavailableException('Blockchain receipt was not returned');
      const event = receipt.logs.map((log: Log | string) => {
        if (typeof log === 'string') return null;
        try { return this.contractInterface.parseLog(log); } catch { return null; }
      }).find((parsed: LogDescription | null) => parsed?.name === 'TransactionProofRecorded');
      return { transactionHash: receipt.hash, blockNumber: receipt.blockNumber, network: (await this.provider.getNetwork()).name, contractAddress: await this.contract.getAddress(), event: event ? { name: event.name, args: Array.from(event.args, (value: unknown) => typeof value === 'bigint' ? value.toString() : value) } : null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Blockchain proof submission failed');
    }
  }

  async verifyProof(referenceInput: string, expectedRecordHash: string) {
    if (!this.contract) throw new ServiceUnavailableException('Blockchain integration is not configured');
    try {
      const response = await this.contract.verifyProof(this.toBytes32(referenceInput), this.toBytes32(expectedRecordHash));
      const receipt = await response.wait();
      if (!receipt) throw new ServiceUnavailableException('Blockchain receipt was not returned');
      const event = receipt.logs.map((log: Log | string) => {
        if (typeof log === 'string') return null;
        try { return this.contractInterface.parseLog(log); } catch { return null; }
      }).find((parsed: LogDescription | null) => parsed?.name === 'TransactionProofVerified');
      return { transactionHash: receipt.hash, blockNumber: receipt.blockNumber, verified: event?.args?.matches ?? false, event: event ? { name: event.name, args: Array.from(event.args, (value: unknown) => typeof value === 'bigint' ? value.toString() : value) } : null };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Blockchain proof verification failed');
    }
  }

  async verifyTransaction(transactionId: string, actor: { sub: string; role: string }) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { id: true, reference: true, type: true, amount: true, currency: true, metadata: true, groupId: true, groupMemberId: true, occurredAt: true, status: true, description: true, blockchainHash: true, groupMember: { select: { userId: true } }, blockchainTransaction: { select: { transactionHash: true } } },
    });
    if (!transaction) throw new NotFoundException('Financial transaction not found');
    if (!['ADMIN', 'SUPER_ADMIN', 'TREASURER', 'AUDITOR', 'LOAN_OFFICER'].includes(actor.role) && transaction.groupMember?.userId !== actor.sub) throw new NotFoundException('Financial transaction not found');
    const databaseHash = this.hashDatabaseRecord(transaction);
    const baseResult = {
      transactionReference: transaction.reference,
      databaseHash,
      blockchainHash: null as string | null,
      blockchainTransactionHash: transaction.blockchainTransaction?.transactionHash ?? transaction.blockchainHash,
      timestamp: null as string | null,
      verificationResult: 'PENDING' as 'VERIFIED' | 'NOT_VERIFIED' | 'PENDING',
    };
    if (!this.contract) return baseResult;
    try {
      const referenceKey = this.toBytes32(transaction.reference);
      if (!(await this.contract.exists(referenceKey))) return baseResult;
      const proof = await this.contract.getProof(referenceKey);
      const blockchainHash = proof.recordHash as string;
      const result = { ...baseResult, blockchainHash, timestamp: new Date(Number(proof.recordedAt) * 1000).toISOString(), verificationResult: blockchainHash.toLowerCase() === databaseHash.toLowerCase() ? 'VERIFIED' as const : 'NOT_VERIFIED' as const };
      await this.notifications.create(actor.sub, 'Blockchain verification completed', `Transaction ${transaction.reference} verification result: ${result.verificationResult}.`, 'SECURITY');
      return result;
    } catch {
      return baseResult;
    }
  }

  private hashDatabaseRecord(record: { id: string; reference: string; type: string; amount: { toString(): string }; currency?: string; metadata?: unknown; groupId: string | null; groupMemberId: string | null; occurredAt: Date; status: string; description: string | null }) {
    const version2 = typeof record.metadata === 'object' && record.metadata !== null && 'proofVersion' in record.metadata && record.metadata.proofVersion === 2;
    const canonicalRecord = JSON.stringify({ ...(version2 ? { version: 2 } : {}), id: record.id, reference: record.reference, type: record.type, amount: record.amount.toString(), ...(version2 ? { currency: record.currency } : {}), groupId: record.groupId, groupMemberId: record.groupMemberId, occurredAt: record.occurredAt.toISOString(), status: record.status, description: record.description });
    return keccak256(toUtf8Bytes(canonicalRecord));
  }

  private toBytes32(value: string) {
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value;
    return keccak256(toUtf8Bytes(value));
  }
}
