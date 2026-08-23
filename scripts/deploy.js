/**
 * deploy.js — Deployment script for HealthRecords contract
 *
 * EDUCATIONAL PROTOTYPE — uses only synthetic/dummy data.
 * All wallet addresses below are local Hardhat test accounts (no real ETH).
 *
 * What this script does:
 *  1. Deploys the HealthRecords contract (deployer becomes admin)
 *  2. Admin registers 2 test doctor addresses
 *  3. Computes SHA-256 hash of each dummy file in offchain-storage/
 *  4. Patient adds a record (with their own hash)
 *  5. A registered doctor adds a record on behalf of the patient
 *  6. Patient grants the doctor global access
 *  7. Doctor successfully calls requestRecordAccess (audit event logged)
 *  8. Saves contract address + ABI to frontend/src/contract-config.js
 *
 * Run:
 *   npx hardhat node         (in one terminal)
 *   npm run deploy            (in another terminal)
 */

const { ethers } = require("hardhat");
const crypto    = require("crypto");
const fs        = require("fs");
const path      = require("path");

async function main() {
  console.log("=".repeat(60));
  console.log("  Decentralized Healthcare Data Exchange Platform");
  console.log("  Deployment Script — Dummy Data Only");
  console.log("  ⚠️  Educational Prototype — NOT HIPAA/GDPR Compliant");
  console.log("=".repeat(60));
  console.log();

  // ─── Step 0: Get test signers (local Hardhat wallets, not real accounts) ────
  const [admin, patientAlice, doctorBob, doctorCarol] = await ethers.getSigners();

  console.log("Test Wallet Addresses (Hardhat local network — NOT real wallets):");
  console.log(`  Admin         : ${admin.address}`);
  console.log(`  Patient Alice : ${patientAlice.address}`);
  console.log(`  Doctor Bob    : ${doctorBob.address}`);
  console.log(`  Doctor Carol  : ${doctorCarol.address}`);
  console.log();

  // ─── Step 1: Deploy the contract ────────────────────────────────────────────
  console.log("--- Step 1: Deploying HealthRecords contract ---");
  const HealthRecords = await ethers.getContractFactory("HealthRecords");
  const healthRecords = await HealthRecords.deploy();
  await healthRecords.waitForDeployment();
  const contractAddress = await healthRecords.getAddress();
  console.log(`  ✅ Contract deployed at: ${contractAddress}`);
  console.log(`  Admin set to:            ${await healthRecords.admin()}`);
  console.log();

  // ─── Step 2: Admin registers test doctors ───────────────────────────────────
  console.log("--- Step 2: Admin registers test doctors ---");
  let tx = await healthRecords.connect(admin).registerDoctor(doctorBob.address);
  await tx.wait();
  console.log(`  ✅ Doctor Bob registered:   ${doctorBob.address}`);

  tx = await healthRecords.connect(admin).registerDoctor(doctorCarol.address);
  await tx.wait();
  console.log(`  ✅ Doctor Carol registered: ${doctorCarol.address}`);
  console.log();

  // ─── Step 3: Compute SHA-256 hashes of dummy off-chain files ────────────────
  console.log("--- Step 3: Computing SHA-256 hashes of off-chain dummy files ---");
  console.log("  (In a real system, these would be real medical files on IPFS)");

  const labReportPath      = path.join(__dirname, "../offchain-storage/sample-lab-report.json");
  const prescriptionPath   = path.join(__dirname, "../offchain-storage/sample-prescription.json");

  const labReportContent    = fs.readFileSync(labReportPath);
  const prescriptionContent = fs.readFileSync(prescriptionPath);

  // SHA-256 produces a 32-byte (256-bit) digest — perfect for Solidity bytes32
  const labReportHash    = "0x" + crypto.createHash("sha256").update(labReportContent).digest("hex");
  const prescriptionHash = "0x" + crypto.createHash("sha256").update(prescriptionContent).digest("hex");

  console.log(`  sample-lab-report.json    SHA-256: ${labReportHash}`);
  console.log(`  sample-prescription.json  SHA-256: ${prescriptionHash}`);
  console.log();

  // ─── Step 4: Patient Alice adds her own record ───────────────────────────────
  console.log("--- Step 4: Patient Alice adds her own blood test record ---");
  tx = await healthRecords.connect(patientAlice).addRecord(
    patientAlice.address,  // patientAddress
    labReportHash,         // documentHash (bytes32 SHA-256 of the off-chain file)
    "BloodTest",           // recordType
    "sample-lab-report.json" // offchainReference (pointer to the off-chain file)
  );
  let receipt = await tx.wait();

  // Parse the RecordAdded event to get the assigned record ID
  const addEvent1 = receipt.logs
    .map(log => { try { return healthRecords.interface.parseLog(log); } catch { return null; } })
    .find(e => e && e.name === "RecordAdded");
  const recordId1 = addEvent1 ? addEvent1.args.recordId.toString() : "1";
  console.log(`  ✅ Record #${recordId1} added — Type: BloodTest`);
  console.log(`     Hash: ${labReportHash.slice(0, 20)}...`);
  console.log(`     Off-chain file: sample-lab-report.json`);
  console.log();

  // ─── Step 5: Doctor Bob adds a prescription record on Alice's behalf ─────────
  console.log("--- Step 5: Doctor Bob adds a prescription record for Alice ---");
  tx = await healthRecords.connect(doctorBob).addRecord(
    patientAlice.address,    // patientAddress (still Alice's record)
    prescriptionHash,        // documentHash
    "Prescription",          // recordType
    "sample-prescription.json" // offchainReference
  );
  receipt = await tx.wait();

  const addEvent2 = receipt.logs
    .map(log => { try { return healthRecords.interface.parseLog(log); } catch { return null; } })
    .find(e => e && e.name === "RecordAdded");
  const recordId2 = addEvent2 ? addEvent2.args.recordId.toString() : "2";
  console.log(`  ✅ Record #${recordId2} added — Type: Prescription`);
  console.log(`     Uploaded by Doctor Bob on behalf of Patient Alice`);
  console.log(`     Hash: ${prescriptionHash.slice(0, 20)}...`);
  console.log(`     Off-chain file: sample-prescription.json`);
  console.log();

  // ─── Step 6: Patient Alice grants Doctor Bob global access ──────────────────
  console.log("--- Step 6: Patient Alice grants Doctor Bob global access ---");
  tx = await healthRecords.connect(patientAlice).grantAccess(doctorBob.address);
  await tx.wait();

  const hasAccess = await healthRecords.hasAccess(patientAlice.address, doctorBob.address);
  console.log(`  ✅ Access granted. hasAccess(Alice, Bob) = ${hasAccess}`);
  console.log();

  // ─── Step 7: Doctor Bob requests access — audit event logged ────────────────
  console.log(`--- Step 7: Doctor Bob requests access to Record #${recordId1} ---`);
  console.log("  (This logs a RecordAccessed event — the immutable audit trail)");
  tx = await healthRecords.connect(doctorBob).requestRecordAccess(
    patientAlice.address,
    parseInt(recordId1)
  );
  receipt = await tx.wait();

  const accessEvent = receipt.logs
    .map(log => { try { return healthRecords.interface.parseLog(log); } catch { return null; } })
    .find(e => e && e.name === "RecordAccessed");

  if (accessEvent) {
    console.log(`  ✅ RecordAccessed event emitted (permanent audit log entry):`);
    console.log(`     Record ID  : ${accessEvent.args.recordId}`);
    console.log(`     Patient    : ${accessEvent.args.patientAddress}`);
    console.log(`     Doctor     : ${accessEvent.args.doctorAddress}`);
    console.log(`     Timestamp  : ${accessEvent.args.timestamp}`);
  }
  console.log();

  // ─── Step 8: Check total record count ───────────────────────────────────────
  const totalRecords = await healthRecords.getRecordCount();
  console.log(`  Total records on-chain: ${totalRecords}`);
  console.log();

  // ─── Step 9: Save contract address + ABI for the frontend ───────────────────
  console.log("--- Step 8: Saving contract config for React frontend ---");

  // Read the compiled ABI from Hardhat's artifacts directory
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/HealthRecords.sol/HealthRecords.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const abi = artifact.abi;

  // Make sure frontend/src/ exists before writing
  const frontendSrcDir = path.join(__dirname, "../frontend/src");
  if (!fs.existsSync(frontendSrcDir)) {
    fs.mkdirSync(frontendSrcDir, { recursive: true });
  }

  // Write the config file — the frontend imports this to connect to the contract
  const configContent =
`// AUTO-GENERATED by scripts/deploy.js — do not edit manually.
// Re-run "npm run deploy" after each fresh deployment to update this file.
// ⚠️  Educational Prototype — NOT HIPAA/GDPR Compliant.

export const CONTRACT_ADDRESS = "${contractAddress}";

export const CONTRACT_ABI = ${JSON.stringify(abi, null, 2)};
`;

  const configPath = path.join(frontendSrcDir, "contract-config.js");
  fs.writeFileSync(configPath, configContent);
  console.log(`  ✅ frontend/src/contract-config.js written`);
  console.log();

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("  Deployment complete!");
  console.log(`  Contract Address : ${contractAddress}`);
  console.log(`  Records added    : ${totalRecords}`);
  console.log();
  console.log("  Next steps:");
  console.log("    cd frontend && npm install && npm run dev");
  console.log("    Import Account 0 (admin) and Account 1 (patient) into MetaMask");
  console.log("    Use private keys shown in 'npx hardhat node' output");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
