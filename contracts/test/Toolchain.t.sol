// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// Proves the pinned compiler, Soldeer dependency and remappings work before any
/// real contract lands (Faucet in B1.1, ENS registrars in A1).
contract ToolchainTest is Test {
    function test_forgeStdIsWired() public pure {
        assertEq(uint256(keccak256("lanyard")), uint256(keccak256(abi.encodePacked("lanyard"))));
    }

    function test_cheatcodesWork() public {
        vm.warp(1_700_000_000);
        assertEq(block.timestamp, 1_700_000_000);
    }
}
