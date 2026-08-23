// hardhat.config.js
// Hardhat configuration for the Decentralized Healthcare Data Exchange Platform.
// Educational prototype — local blockchain only, no mainnet deployment.

require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // ─── Solidity Compiler ────────────────────────────────────────────────────
  solidity: {
    version: "0.8.20",       // Must match the pragma in HealthRecords.sol
    settings: {
      optimizer: {
        enabled: true,       // Reduces deployed bytecode size
        runs: 200,           // Optimized for typical usage frequency
      },
    },
  },

  // ─── Networks ─────────────────────────────────────────────────────────────
  networks: {
    // Default in-process network used by 'npx hardhat test'
    hardhat: {
      chainId: 31337,
    },
    // External local node used by 'npx hardhat node' + deploy script
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },

  // ─── File Paths ───────────────────────────────────────────────────────────
  paths: {
    sources:   "./contracts",   // Where Solidity files live
    tests:     "./test",        // Where test files live
    cache:     "./cache",       // Hardhat compilation cache
    artifacts: "./artifacts",   // Compiled ABI + bytecode output
  },
};
