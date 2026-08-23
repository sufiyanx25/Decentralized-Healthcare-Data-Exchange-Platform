// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  HealthRecords
 * @notice A decentralized medical record access-control system.
 *
 * ⚠️  EDUCATIONAL PROTOTYPE ONLY — NOT HIPAA/GDPR COMPLIANT.
 *     Use only with synthetic/dummy data. Never store real patient information.
 *
 * @dev    Architecture Summary:
 *         - Medical FILES are stored OFF-CHAIN (local folder / IPFS in production).
 *         - Only the SHA-256 HASH of each file is stored on-chain as a bytes32 value.
 *         - Patients control which doctors can see their records (global consent model).
 *         - Every successful doctor access emits a RecordAccessed event — this IS the
 *           immutable audit trail. It cannot be deleted or altered after being logged.
 *
 * @dev    Global Consent Model:
 *         A patient calls grantAccess(doctorAddress) ONCE. That doctor can then access
 *         ALL of that patient's records until the patient calls revokeAccess().
 *         This is simpler than per-record consent and sufficient for a prototype.
 */
contract HealthRecords {

    // =========================================================================
    //  STATE VARIABLES
    // =========================================================================

    /// @notice The admin address — set at deployment.
    ///         Admin can register verified doctor/hospital wallet addresses.
    address public admin;

    /// @dev Auto-incrementing counter. First record gets ID = 1, never 0.
    uint256 private recordCounter;

    // =========================================================================
    //  STRUCTS
    // =========================================================================

    /**
     * @notice Represents one medical record entry stored on-chain.
     * @dev    The actual medical FILE is stored off-chain.
     *         Only the SHA-256 hash of that file is stored here (documentHash).
     *         Anyone can later re-hash the off-chain file and compare to
     *         documentHash to verify the file has not been tampered with.
     */
    struct MedicalRecord {
        uint256 recordId;           // Unique auto-incremented ID
        address patientAddress;     // Wallet address of the patient who owns this record
        address uploadedBy;         // Wallet address of whoever submitted this record
        bytes32 documentHash;       // SHA-256 hash of the off-chain medical file
        string  recordType;         // e.g. "BloodTest", "XRay", "Prescription"
        string  offchainReference;  // Pointer to the off-chain file (filename or IPFS CID)
        uint256 timestamp;          // block.timestamp when the record was registered
        bool    exists;             // Set to true on creation; used to validate record IDs
    }

    // =========================================================================
    //  MAPPINGS
    // =========================================================================

    /// @dev recordId => MedicalRecord
    mapping(uint256 => MedicalRecord) private records;

    /// @dev patientAddress => list of record IDs belonging to that patient
    mapping(address => uint256[]) private patientRecords;

    /**
     * @dev Global consent: consent[patientAddress][doctorAddress] == true
     *      means that doctor currently has access to ALL of that patient's records.
     *      The patient can set this to false at any time by calling revokeAccess().
     */
    mapping(address => mapping(address => bool)) private consent;

    /// @dev doctorAddress => bool — tracks which addresses are admin-verified doctors
    mapping(address => bool) public isRegisteredDoctor;

    // =========================================================================
    //  EVENTS  (these form the on-chain audit trail — permanent and immutable)
    // =========================================================================

    /**
     * @notice Emitted when admin registers a new doctor/hospital wallet.
     * @param doctorAddress The wallet that was registered.
     * @param timestamp     Block timestamp of the registration.
     */
    event DoctorRegistered(address indexed doctorAddress, uint256 timestamp);

    /**
     * @notice Emitted when a new medical record is added on-chain.
     * @param recordId      The unique ID assigned to this record.
     * @param patientAddress The patient who owns this record.
     * @param uploadedBy    Who uploaded it (patient themselves or a registered doctor).
     * @param recordType    Category label for the record.
     * @param timestamp     Block timestamp when the record was added.
     */
    event RecordAdded(
        uint256 indexed recordId,
        address indexed patientAddress,
        address indexed uploadedBy,
        string  recordType,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a patient grants a doctor access to their records.
     * @param patientAddress The patient giving consent.
     * @param doctorAddress  The doctor receiving access.
     * @param timestamp      Block timestamp of the consent grant.
     */
    event AccessGranted(
        address indexed patientAddress,
        address indexed doctorAddress,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a patient revokes a doctor's access.
     *         After this event, the doctor can no longer call requestRecordAccess.
     * @param patientAddress The patient revoking consent.
     * @param doctorAddress  The doctor losing access.
     * @param timestamp      Block timestamp of the revocation.
     */
    event AccessRevoked(
        address indexed patientAddress,
        address indexed doctorAddress,
        uint256 timestamp
    );

    /**
     * @notice THE IMMUTABLE AUDIT LOG.
     *         Emitted every time an authorized doctor successfully accesses a record.
     *         This event is stored permanently on-chain and can NEVER be deleted.
     *         It records exactly who accessed what patient's record, and when.
     *         Even if access is later revoked, this historical log remains forever.
     * @param recordId       The ID of the record that was accessed.
     * @param patientAddress The patient whose record was accessed.
     * @param doctorAddress  The doctor who accessed the record.
     * @param timestamp      Block timestamp of the access.
     */
    event RecordAccessed(
        uint256 indexed recordId,
        address indexed patientAddress,
        address indexed doctorAddress,
        uint256 timestamp
    );

    // =========================================================================
    //  MODIFIERS
    // =========================================================================

    /**
     * @dev Restricts a function so only the admin address can call it.
     *      Reverts with a clear message if anyone else tries.
     */
    modifier onlyAdmin() {
        require(msg.sender == admin, "HealthRecords: caller is not admin");
        _;
    }

    // =========================================================================
    //  CONSTRUCTOR
    // =========================================================================

    /**
     * @notice Deploys the contract and sets the deploying address as admin.
     * @dev    The admin is responsible for registering verified doctor/hospital
     *         wallet addresses. Admin is NOT automatically a patient.
     */
    constructor() {
        admin = msg.sender;
        recordCounter = 0;
    }

    // =========================================================================
    //  ADMIN FUNCTIONS
    // =========================================================================

    /**
     * @notice Admin registers a verified doctor or hospital wallet address.
     * @dev    Only registered doctors (or the patient themselves) are allowed to
     *         call addRecord(). This prevents random wallets from uploading records
     *         on behalf of patients without authorization.
     *
     *         In a production system, this might be replaced by a DID-based
     *         identity verification system. For this prototype, admin trust is enough.
     *
     * @param doctorAddress The wallet address to register as a verified doctor.
     */
    function registerDoctor(address doctorAddress) external onlyAdmin {
        require(doctorAddress != address(0), "HealthRecords: zero address not allowed");
        require(
            !isRegisteredDoctor[doctorAddress],
            "HealthRecords: doctor already registered"
        );
        isRegisteredDoctor[doctorAddress] = true;
        emit DoctorRegistered(doctorAddress, block.timestamp);
    }

    // =========================================================================
    //  RECORD MANAGEMENT
    // =========================================================================

    /**
     * @notice Add a new medical record for a patient.
     *
     *         The actual medical FILE must be stored off-chain by the caller.
     *         Only the SHA-256 hash of that file is stored here on-chain.
     *         This hash acts as a cryptographic fingerprint — anyone can later
     *         re-hash the file and compare to verify it has not been tampered with.
     *
     * @dev    Who can call this function?
     *         - The patient themselves (msg.sender == patientAddress)
     *         - A registered doctor/hospital acting on the patient's behalf
     *         An unregistered wallet trying to add records for someone else will be
     *         rejected by the require() statement below.
     *
     * @param patientAddress    The patient's wallet address who owns this record.
     * @param documentHash      SHA-256 hash (as bytes32) of the off-chain medical file.
     * @param recordType        Short label: "BloodTest", "XRay", "Prescription", etc.
     * @param offchainReference Pointer to the off-chain file (filename, IPFS CID, etc.).
     * @return newRecordId      The unique ID assigned to this new record.
     */
    function addRecord(
        address patientAddress,
        bytes32 documentHash,
        string calldata recordType,
        string calldata offchainReference
    ) external returns (uint256) {
        // Input validation
        require(patientAddress != address(0), "HealthRecords: invalid patient address");
        require(documentHash != bytes32(0), "HealthRecords: document hash cannot be empty");
        require(bytes(recordType).length > 0,  "HealthRecords: record type cannot be empty");

        // Access control: only the patient or a registered doctor can add records
        require(
            msg.sender == patientAddress || isRegisteredDoctor[msg.sender],
            "HealthRecords: caller is not the patient or a registered doctor"
        );

        // Assign a new unique ID (starts at 1, so 0 always means "not found")
        recordCounter++;
        uint256 newRecordId = recordCounter;

        // Store the record metadata + hash on-chain
        // The actual file stays off-chain — only the hash is here
        records[newRecordId] = MedicalRecord({
            recordId:          newRecordId,
            patientAddress:    patientAddress,
            uploadedBy:        msg.sender,
            documentHash:      documentHash,
            recordType:        recordType,
            offchainReference: offchainReference,
            timestamp:         block.timestamp,
            exists:            true
        });

        // Link this record to the patient's personal record list
        patientRecords[patientAddress].push(newRecordId);

        emit RecordAdded(newRecordId, patientAddress, msg.sender, recordType, block.timestamp);

        return newRecordId;
    }

    // =========================================================================
    //  CONSENT MANAGEMENT
    // =========================================================================

    /**
     * @notice Patient grants a doctor access to ALL their records (global consent).
     *
     *         This uses the "global consent" model: one approval covers all of
     *         the patient's records (past and future) until explicitly revoked.
     *         The patient is always in control — this can be revoked at any time.
     *
     * @dev    msg.sender IS the patient granting access. No admin or third-party
     *         can grant consent on behalf of a patient.
     *
     * @param doctorAddress The doctor's wallet address to approve.
     */
    function grantAccess(address doctorAddress) external {
        require(doctorAddress != address(0),        "HealthRecords: invalid doctor address");
        require(doctorAddress != msg.sender,         "HealthRecords: cannot grant access to yourself");
        require(!consent[msg.sender][doctorAddress], "HealthRecords: access already granted");

        consent[msg.sender][doctorAddress] = true;
        emit AccessGranted(msg.sender, doctorAddress, block.timestamp);
    }

    /**
     * @notice Patient revokes a doctor's access to their records.
     *
     *         Revocation takes effect immediately — the next call to
     *         requestRecordAccess by that doctor will be rejected.
     *         The revocation event is permanently logged on-chain,
     *         even though the previously logged RecordAccessed events also remain.
     *
     * @dev    msg.sender IS the patient revoking access.
     *
     * @param doctorAddress The doctor's wallet address to revoke.
     */
    function revokeAccess(address doctorAddress) external {
        require(doctorAddress != address(0),       "HealthRecords: invalid doctor address");
        require(consent[msg.sender][doctorAddress], "HealthRecords: no active consent to revoke");

        consent[msg.sender][doctorAddress] = false;
        emit AccessRevoked(msg.sender, doctorAddress, block.timestamp);
    }

    // =========================================================================
    //  ACCESS & RETRIEVAL
    // =========================================================================

    /**
     * @notice Doctor requests access to a specific patient record.
     *
     *         This is the CORE access-control function.
     *         The contract checks consent BEFORE returning any data.
     *         If the patient has not granted consent, the transaction is REVERTED.
     *
     *         On SUCCESS: a RecordAccessed event is emitted — THIS IS THE AUDIT LOG.
     *         Every authorized doctor access is permanently recorded on-chain.
     *         Even if access is revoked later, these audit events remain forever.
     *
     * @dev    This is NOT a view function — it emits an event (the audit entry).
     *         That means it costs gas, which also prevents spam access attempts.
     *         Doctors should use this function (not getRecord) to ensure all accesses
     *         are logged in the immutable audit trail.
     *
     * @param patientAddress The patient whose record is being requested.
     * @param recordId       The specific record ID to access.
     * @return               Full record details (metadata + hash).
     *                       The actual file must be fetched separately off-chain.
     */
    function requestRecordAccess(
        address patientAddress,
        uint256 recordId
    )
        external
        returns (
            uint256,  // recordId
            address,  // patientAddress
            address,  // uploadedBy
            bytes32,  // documentHash
            string memory, // recordType
            string memory, // offchainReference
            uint256   // timestamp
        )
    {
        // Validate inputs
        require(patientAddress != address(0), "HealthRecords: invalid patient address");
        require(records[recordId].exists,     "HealthRecords: record does not exist");
        require(
            records[recordId].patientAddress == patientAddress,
            "HealthRecords: record does not belong to this patient"
        );

        // THE CORE ACCESS CHECK — if this fails, everything reverts
        // The patient must have explicitly called grantAccess(msg.sender) before this
        require(
            consent[patientAddress][msg.sender],
            "HealthRecords: access not authorized - patient has not granted consent"
        );

        MedicalRecord storage rec = records[recordId];

        // Emit the audit log event — permanently records this access on-chain
        // This line is what makes the audit trail immutable
        emit RecordAccessed(recordId, patientAddress, msg.sender, block.timestamp);

        return (
            rec.recordId,
            rec.patientAddress,
            rec.uploadedBy,
            rec.documentHash,
            rec.recordType,
            rec.offchainReference,
            rec.timestamp
        );
    }

    /**
     * @notice Returns all records belonging to the calling patient (msg.sender).
     * @dev    Only the patient can retrieve their own list this way.
     *         Doctors must use requestRecordAccess() (which logs an audit event).
     *         This is a view function — it does NOT emit any event.
     * @return Array of MedicalRecord structs belonging to msg.sender.
     */
    function getMyRecords() external view returns (MedicalRecord[] memory) {
        uint256[] storage ids = patientRecords[msg.sender];
        MedicalRecord[] memory result = new MedicalRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = records[ids[i]];
        }
        return result;
    }

    /**
     * @notice Returns a single record by ID.
     *         Only accessible by the patient who owns the record, or a consented doctor.
     *
     * @dev    This is a VIEW function — it does NOT emit a RecordAccessed audit event.
     *         If you are a doctor and need your access to be logged on-chain,
     *         use requestRecordAccess() instead. This function is provided as a
     *         convenience for the patient's own dashboard.
     *
     * @param recordId The ID of the record to retrieve.
     * @return The MedicalRecord struct.
     */
    function getRecord(uint256 recordId) external view returns (MedicalRecord memory) {
        require(records[recordId].exists, "HealthRecords: record does not exist");
        address patientAddr = records[recordId].patientAddress;
        require(
            msg.sender == patientAddr || consent[patientAddr][msg.sender],
            "HealthRecords: not authorized to view this record"
        );
        return records[recordId];
    }

    /**
     * @notice Check whether a doctor currently has consent from a patient.
     * @dev    Pure read — no gas cost when called off-chain (e.g. from a frontend).
     * @param patientAddress The patient's wallet address.
     * @param doctorAddress  The doctor's wallet address.
     * @return bool          true if the doctor currently has consent, false otherwise.
     */
    function hasAccess(
        address patientAddress,
        address doctorAddress
    ) external view returns (bool) {
        return consent[patientAddress][doctorAddress];
    }

    /**
     * @notice Returns the total number of records ever registered in this contract.
     * @return Current record count (also the ID of the last record added).
     */
    function getRecordCount() external view returns (uint256) {
        return recordCounter;
    }
}
