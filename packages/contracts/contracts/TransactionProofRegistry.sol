// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stores non-sensitive proofs that off-chain financial records existed at a point in time.
contract TransactionProofRegistry {
    struct Proof {
        bytes32 recordHash;
        uint64 recordedAt;
        bytes32 transactionType;
        bytes32 verificationData;
        bool exists;
    }

    address public immutable owner;
    mapping(address => bool) public writers;
    mapping(bytes32 => Proof) private proofs;

    error NotOwner();
    error NotWriter();
    error EmptyReference();
    error DuplicateReference(bytes32 referenceKey);
    error UnknownReference(bytes32 referenceKey);
    error EmptyRecordHash();

    event WriterUpdated(address indexed writer, bool allowed);
    event TransactionProofRecorded(bytes32 indexed referenceKey, bytes32 indexed recordHash, bytes32 transactionType, uint64 recordedAt);
    event TransactionProofVerified(bytes32 indexed referenceKey, bytes32 indexed recordHash, address indexed verifier, bool matches);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyWriter() {
        if (!writers[msg.sender]) revert NotWriter();
        _;
    }

    constructor() {
        owner = msg.sender;
        writers[msg.sender] = true;
        emit WriterUpdated(msg.sender, true);
    }

    function setWriter(address writer, bool allowed) external onlyOwner {
        writers[writer] = allowed;
        emit WriterUpdated(writer, allowed);
    }

    function recordProof(
        bytes32 referenceKey,
        bytes32 recordHash,
        bytes32 transactionType,
        bytes32 verificationData
    ) external onlyWriter {
        if (referenceKey == bytes32(0)) revert EmptyReference();
        if (recordHash == bytes32(0)) revert EmptyRecordHash();
        if (proofs[referenceKey].exists) revert DuplicateReference(referenceKey);

        uint64 timestamp = uint64(block.timestamp);
        proofs[referenceKey] = Proof(recordHash, timestamp, transactionType, verificationData, true);
        emit TransactionProofRecorded(referenceKey, recordHash, transactionType, timestamp);
    }

    function exists(bytes32 referenceKey) external view returns (bool) {
        return proofs[referenceKey].exists;
    }

    function getProof(bytes32 referenceKey) external view returns (Proof memory) {
        if (!proofs[referenceKey].exists) revert UnknownReference(referenceKey);
        return proofs[referenceKey];
    }

    function verifyProof(bytes32 referenceKey, bytes32 expectedRecordHash) external returns (bool matches) {
        if (!proofs[referenceKey].exists) revert UnknownReference(referenceKey);
        matches = proofs[referenceKey].recordHash == expectedRecordHash;
        emit TransactionProofVerified(referenceKey, proofs[referenceKey].recordHash, msg.sender, matches);
    }
}
