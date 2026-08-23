/**
 * HealthRecords.test.js — Complete test suite for the HealthRecords smart contract
 *
 * Framework: Hardhat + Chai + @nomicfoundation/hardhat-toolbox
 *
 * ⚠️  Educational Prototype — all data used here is synthetic/dummy data only.
 *
 * Coverage:
 *   ✅ Deployment (admin set correctly, counter starts at zero)
 *   ✅ Doctor registration (admin can register, non-admin cannot)
 *   ✅ addRecord (patient, registered doctor, unauthorized wallet, edge cases)
 *   ✅ getMyRecords (returns only the calling patient's own records)
 *   ✅ grantAccess (patient grants, cannot double-grant, cannot self-grant)
 *   ✅ revokeAccess (patient revokes, cannot revoke what was never granted)
 *   ✅ requestRecordAccess (authorized doctor, unauthorized doctor, after revocation)
 *   ✅ getRecord (patient, consented doctor, unauthorized wallet)
 *   ✅ Event emission (RecordAdded, AccessGranted, AccessRevoked, RecordAccessed)
 *   ✅ Edge cases (non-existent record, zero addresses, wrong patient)
 */

const { expect }   = require("chai");
const { ethers }   = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const crypto       = require("crypto");

// Helper: compute SHA-256 of a string and return as a 0x-prefixed hex string (bytes32)
function sha256Hex(input) {
  return "0x" + crypto.createHash("sha256").update(input).digest("hex");
}

describe("HealthRecords Contract", function () {
  // Test signers (local Hardhat wallets — not real accounts)
  let healthRecords;
  let admin, patient1, patient2, doctor1, doctor2, stranger;

  // Dummy SHA-256 hashes (would represent real file hashes in production)
  const dummyHash1 = sha256Hex("dummy medical file content — lab report");
  const dummyHash2 = sha256Hex("dummy medical file content — prescription");

  // Deploy a fresh contract before EACH test to ensure test isolation
  beforeEach(async function () {
    [admin, patient1, patient2, doctor1, doctor2, stranger] = await ethers.getSigners();
    const HealthRecordsFactory = await ethers.getContractFactory("HealthRecords");
    healthRecords = await HealthRecordsFactory.deploy();
    await healthRecords.waitForDeployment();
  });

  // ===========================================================================
  //  DEPLOYMENT
  // ===========================================================================

  describe("Deployment", function () {

    it("Should set the deploying address as admin", async function () {
      expect(await healthRecords.admin()).to.equal(admin.address);
    });

    it("Should start with a record count of zero", async function () {
      expect(await healthRecords.getRecordCount()).to.equal(0);
    });

    it("Should not mark any address as a registered doctor at deployment", async function () {
      expect(await healthRecords.isRegisteredDoctor(doctor1.address)).to.be.false;
    });
  });

  // ===========================================================================
  //  DOCTOR REGISTRATION
  // ===========================================================================

  describe("registerDoctor", function () {

    it("Admin can successfully register a doctor address", async function () {
      await healthRecords.connect(admin).registerDoctor(doctor1.address);
      expect(await healthRecords.isRegisteredDoctor(doctor1.address)).to.be.true;
    });

    it("Non-admin (stranger) cannot register a doctor address", async function () {
      await expect(
        healthRecords.connect(stranger).registerDoctor(doctor1.address)
      ).to.be.revertedWith("HealthRecords: caller is not admin");
    });

    it("Non-admin (patient) cannot register a doctor address", async function () {
      await expect(
        healthRecords.connect(patient1).registerDoctor(doctor1.address)
      ).to.be.revertedWith("HealthRecords: caller is not admin");
    });

    it("Admin cannot register the zero address", async function () {
      await expect(
        healthRecords.connect(admin).registerDoctor(ethers.ZeroAddress)
      ).to.be.revertedWith("HealthRecords: zero address not allowed");
    });

    it("Admin cannot register the same doctor address twice", async function () {
      await healthRecords.connect(admin).registerDoctor(doctor1.address);
      await expect(
        healthRecords.connect(admin).registerDoctor(doctor1.address)
      ).to.be.revertedWith("HealthRecords: doctor already registered");
    });

    it("DoctorRegistered event is emitted with correct doctor address", async function () {
      await expect(
        healthRecords.connect(admin).registerDoctor(doctor1.address)
      )
        .to.emit(healthRecords, "DoctorRegistered")
        .withArgs(doctor1.address, anyValue); // anyValue matches any timestamp
    });
  });

  // ===========================================================================
  //  ADD RECORD
  // ===========================================================================

  describe("addRecord", function () {

    it("Patient can add their own medical record", async function () {
      await healthRecords.connect(patient1).addRecord(
        patient1.address, dummyHash1, "BloodTest", "sample-lab-report.json"
      );
      expect(await healthRecords.getRecordCount()).to.equal(1);
    });

    it("A registered doctor can add a record on behalf of a patient", async function () {
      await healthRecords.connect(admin).registerDoctor(doctor1.address);
      await healthRecords.connect(doctor1).addRecord(
        patient1.address, dummyHash1, "Prescription", "sample-prescription.json"
      );
      expect(await healthRecords.getRecordCount()).to.equal(1);
    });

    it("An unregistered stranger cannot add a record for another patient", async function () {
      await expect(
        healthRecords.connect(stranger).addRecord(
          patient1.address, dummyHash1, "BloodTest", "file.json"
        )
      ).to.be.revertedWith(
        "HealthRecords: caller is not the patient or a registered doctor"
      );
    });

    it("Cannot add a record with a zero/empty document hash", async function () {
      await expect(
        healthRecords.connect(patient1).addRecord(
          patient1.address, ethers.ZeroHash, "BloodTest", "file.json"
        )
      ).to.be.revertedWith("HealthRecords: document hash cannot be empty");
    });

    it("Cannot add a record with an empty record type string", async function () {
      await expect(
        healthRecords.connect(patient1).addRecord(
          patient1.address, dummyHash1, "", "file.json"
        )
      ).to.be.revertedWith("HealthRecords: record type cannot be empty");
    });

    it("Cannot add a record with the zero address as patient", async function () {
      await expect(
        healthRecords.connect(patient1).addRecord(
          ethers.ZeroAddress, dummyHash1, "BloodTest", "file.json"
        )
      ).to.be.revertedWith("HealthRecords: invalid patient address");
    });

    it("Record counter increments correctly with multiple additions", async function () {
      await healthRecords.connect(patient1).addRecord(patient1.address, dummyHash1, "BloodTest", "f1.json");
      await healthRecords.connect(patient1).addRecord(patient1.address, dummyHash2, "XRay", "f2.json");
      expect(await healthRecords.getRecordCount()).to.equal(2);
    });

    it("RecordAdded event is emitted with correct arguments", async function () {
      await expect(
        healthRecords.connect(patient1).addRecord(
          patient1.address, dummyHash1, "XRay", "sample-xray.json"
        )
      )
        .to.emit(healthRecords, "RecordAdded")
        .withArgs(
          1,                    // first record gets ID 1
          patient1.address,     // patientAddress
          patient1.address,     // uploadedBy (patient added their own)
          "XRay",               // recordType
          anyValue              // timestamp (any value)
        );
    });
  });

  // ===========================================================================
  //  GET MY RECORDS
  // ===========================================================================

  describe("getMyRecords", function () {

    it("Patient sees only their own records, not another patient's", async function () {
      // Patient1 adds 2 records
      await healthRecords.connect(patient1).addRecord(patient1.address, dummyHash1, "BloodTest", "f1.json");
      await healthRecords.connect(patient1).addRecord(patient1.address, dummyHash2, "XRay", "f2.json");

      // Patient2 adds 1 record
      await healthRecords.connect(patient2).addRecord(patient2.address, dummyHash1, "Prescription", "f3.json");

      const p1Records = await healthRecords.connect(patient1).getMyRecords();
      const p2Records = await healthRecords.connect(patient2).getMyRecords();

      // Patient1 should see exactly 2 records
      expect(p1Records.length).to.equal(2);
      expect(p1Records[0].recordType).to.equal("BloodTest");
      expect(p1Records[1].recordType).to.equal("XRay");

      // Patient2 should see exactly 1 record
      expect(p2Records.length).to.equal(1);
      expect(p2Records[0].recordType).to.equal("Prescription");
    });

    it("New patient with no records gets an empty array", async function () {
      const records = await healthRecords.connect(patient2).getMyRecords();
      expect(records.length).to.equal(0);
    });
  });

  // ===========================================================================
  //  GRANT ACCESS
  // ===========================================================================

  describe("grantAccess", function () {

    it("Patient can grant a doctor access — hasAccess returns true", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      expect(
        await healthRecords.hasAccess(patient1.address, doctor1.address)
      ).to.be.true;
    });

    it("Patient cannot grant access to themselves", async function () {
      await expect(
        healthRecords.connect(patient1).grantAccess(patient1.address)
      ).to.be.revertedWith("HealthRecords: cannot grant access to yourself");
    });

    it("Cannot grant access to the zero address", async function () {
      await expect(
        healthRecords.connect(patient1).grantAccess(ethers.ZeroAddress)
      ).to.be.revertedWith("HealthRecords: invalid doctor address");
    });

    it("Cannot call grantAccess for an address that already has access", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await expect(
        healthRecords.connect(patient1).grantAccess(doctor1.address)
      ).to.be.revertedWith("HealthRecords: access already granted");
    });

    it("AccessGranted event is emitted with correct arguments", async function () {
      await expect(
        healthRecords.connect(patient1).grantAccess(doctor1.address)
      )
        .to.emit(healthRecords, "AccessGranted")
        .withArgs(patient1.address, doctor1.address, anyValue);
    });
  });

  // ===========================================================================
  //  REVOKE ACCESS
  // ===========================================================================

  describe("revokeAccess", function () {

    it("Patient can revoke a doctor's access — hasAccess returns false afterwards", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await healthRecords.connect(patient1).revokeAccess(doctor1.address);
      expect(
        await healthRecords.hasAccess(patient1.address, doctor1.address)
      ).to.be.false;
    });

    it("Cannot revoke access that was never granted", async function () {
      await expect(
        healthRecords.connect(patient1).revokeAccess(doctor1.address)
      ).to.be.revertedWith("HealthRecords: no active consent to revoke");
    });

    it("AccessRevoked event is emitted with correct arguments", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await expect(
        healthRecords.connect(patient1).revokeAccess(doctor1.address)
      )
        .to.emit(healthRecords, "AccessRevoked")
        .withArgs(patient1.address, doctor1.address, anyValue);
    });

    it("A different patient's consent is unaffected by another patient's revocation", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await healthRecords.connect(patient2).grantAccess(doctor1.address);

      // Patient1 revokes
      await healthRecords.connect(patient1).revokeAccess(doctor1.address);

      // Patient2's consent should still be active
      expect(
        await healthRecords.hasAccess(patient2.address, doctor1.address)
      ).to.be.true;
    });
  });

  // ===========================================================================
  //  REQUEST RECORD ACCESS
  // ===========================================================================

  describe("requestRecordAccess", function () {

    // Add a record for patient1 before each test in this suite
    beforeEach(async function () {
      await healthRecords.connect(patient1).addRecord(
        patient1.address, dummyHash1, "BloodTest", "sample-lab-report.json"
      );
    });

    it("Doctor WITH consent can successfully request access (RecordAccessed event emitted)", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);

      await expect(
        healthRecords.connect(doctor1).requestRecordAccess(patient1.address, 1)
      )
        .to.emit(healthRecords, "RecordAccessed")
        .withArgs(1, patient1.address, doctor1.address, anyValue);
    });

    it("Doctor WITHOUT consent is rejected when calling requestRecordAccess", async function () {
      // doctor1 has NO consent from patient1 — should revert
      await expect(
        healthRecords.connect(doctor1).requestRecordAccess(patient1.address, 1)
      ).to.be.revertedWith(
        "HealthRecords: access not authorized - patient has not granted consent"
      );
    });

    it("After revocation, a previously-approved doctor can no longer access records", async function () {
      // Grant then immediately revoke
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await healthRecords.connect(patient1).revokeAccess(doctor1.address);

      // Now doctor1 should be denied
      await expect(
        healthRecords.connect(doctor1).requestRecordAccess(patient1.address, 1)
      ).to.be.revertedWith(
        "HealthRecords: access not authorized - patient has not granted consent"
      );
    });

    it("Attempting to access a non-existent record ID is rejected", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      await expect(
        healthRecords.connect(doctor1).requestRecordAccess(patient1.address, 999)
      ).to.be.revertedWith("HealthRecords: record does not exist");
    });

    it("Doctor cannot use patient1's address to access a record that belongs to patient2", async function () {
      // Patient2 adds their own record (ID = 2)
      await healthRecords.connect(patient2).addRecord(
        patient2.address, dummyHash2, "Prescription", "sample-prescription.json"
      );
      // Doctor has consent from patient1 (not patient2)
      await healthRecords.connect(patient1).grantAccess(doctor1.address);

      // Doctor tries to request patient2's record (ID=2) using patient1 as the patient param
      await expect(
        healthRecords.connect(doctor1).requestRecordAccess(patient1.address, 2)
      ).to.be.revertedWith("HealthRecords: record does not belong to this patient");
    });

    it("Stranger with no consent cannot access any record", async function () {
      await expect(
        healthRecords.connect(stranger).requestRecordAccess(patient1.address, 1)
      ).to.be.revertedWith(
        "HealthRecords: access not authorized - patient has not granted consent"
      );
    });
  });

  // ===========================================================================
  //  GET RECORD (view — no audit log emitted)
  // ===========================================================================

  describe("getRecord", function () {

    beforeEach(async function () {
      // patient1 adds a record (ID = 1)
      await healthRecords.connect(patient1).addRecord(
        patient1.address, dummyHash1, "BloodTest", "sample-lab-report.json"
      );
    });

    it("Patient can view their own record via getRecord", async function () {
      const rec = await healthRecords.connect(patient1).getRecord(1);
      expect(rec.recordType).to.equal("BloodTest");
      expect(rec.patientAddress).to.equal(patient1.address);
      expect(rec.documentHash).to.equal(dummyHash1);
    });

    it("Consented doctor can view a record via getRecord", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      const rec = await healthRecords.connect(doctor1).getRecord(1);
      expect(rec.recordType).to.equal("BloodTest");
    });

    it("Unauthorized wallet cannot view a record via getRecord", async function () {
      await expect(
        healthRecords.connect(stranger).getRecord(1)
      ).to.be.revertedWith("HealthRecords: not authorized to view this record");
    });

    it("Requesting a non-existent record ID reverts", async function () {
      await expect(
        healthRecords.connect(patient1).getRecord(42)
      ).to.be.revertedWith("HealthRecords: record does not exist");
    });
  });

  // ===========================================================================
  //  HAS ACCESS (view)
  // ===========================================================================

  describe("hasAccess", function () {

    it("Returns false when no consent has been given", async function () {
      expect(
        await healthRecords.hasAccess(patient1.address, doctor1.address)
      ).to.be.false;
    });

    it("Returns true after grantAccess and false after revokeAccess", async function () {
      await healthRecords.connect(patient1).grantAccess(doctor1.address);
      expect(await healthRecords.hasAccess(patient1.address, doctor1.address)).to.be.true;

      await healthRecords.connect(patient1).revokeAccess(doctor1.address);
      expect(await healthRecords.hasAccess(patient1.address, doctor1.address)).to.be.false;
    });
  });
});
