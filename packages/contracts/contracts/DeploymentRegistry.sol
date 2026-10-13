// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Foundation-only deployment marker. Financial contracts are added in later modules.
contract DeploymentRegistry {
    address public immutable deployer;

    constructor() {
        deployer = msg.sender;
    }
}
