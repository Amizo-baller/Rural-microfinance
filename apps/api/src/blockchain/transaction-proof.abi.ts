export const transactionProofRegistryAbi = [
  'function recordProof(bytes32 referenceKey, bytes32 recordHash, bytes32 transactionType, bytes32 verificationData)',
  'function exists(bytes32 referenceKey) view returns (bool)',
  'function getProof(bytes32 referenceKey) view returns (tuple(bytes32 recordHash, uint64 recordedAt, bytes32 transactionType, bytes32 verificationData, bool exists))',
  'function verifyProof(bytes32 referenceKey, bytes32 expectedRecordHash) returns (bool)',
  'event TransactionProofRecorded(bytes32 indexed referenceKey, bytes32 indexed recordHash, bytes32 transactionType, uint64 recordedAt)',
  'event TransactionProofVerified(bytes32 indexed referenceKey, bytes32 indexed recordHash, address indexed verifier, bool matches)',
] as const;
