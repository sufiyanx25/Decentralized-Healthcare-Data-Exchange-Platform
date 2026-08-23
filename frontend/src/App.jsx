/**
 * App.jsx — Main React application for the Healthcare Data Exchange Platform
 *
 * ⚠️  EDUCATIONAL PROTOTYPE ONLY — NOT HIPAA/GDPR COMPLIANT
 *     All data used here is SYNTHETIC/DUMMY — never use real patient information.
 *
 * How to use:
 *  1. Run: npx hardhat node         (start local blockchain)
 *  2. Run: npm run deploy            (from project root — updates contract-config.js)
 *  3. Run: npm run dev               (from frontend/ folder — opens this app)
 *  4. Import a Hardhat test account into MetaMask using the private key shown
 *     in the "npx hardhat node" terminal output.
 *
 * Architecture:
 *  - Connect MetaMask → creates ethers.BrowserProvider + Contract instance
 *  - Toggle between Patient Mode and Doctor Mode
 *  - Patient Mode: view records, add record (auto-hash), grant/revoke/check access
 *  - Doctor Mode: enter patient address + record ID → requestRecordAccess → display or deny
 *
 * SHA-256 hashing uses the browser's built-in Web Crypto API (crypto.subtle) —
 * no extra libraries needed.
 */

import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESS, CONTRACT_ABI } from './contract-config';
import './App.css';

// ─── Setup Guard ──────────────────────────────────────────────────────────────
// If the deploy script hasn't been run yet, show setup instructions instead.
const IS_CONFIGURED = CONTRACT_ADDRESS !== "PASTE_DEPLOYED_CONTRACT_ADDRESS_HERE"
  && CONTRACT_ADDRESS !== ""
  && CONTRACT_ABI.length > 0;

// ─── Dummy Off-Chain File Contents ───────────────────────────────────────────
// These simulate reading files from the offchain-storage/ folder.
// In production, these would be fetched from IPFS or an encrypted server.
// The SHA-256 of these strings will be computed and stored on-chain.
//
// NOTE: The hash of these strings will differ from the deploy script's hashes
// (which read the actual JSON files from disk). This is expected — in this
// prototype, the deploy script and frontend each show the concept independently.
// In a real system, both would read the same file from the same source.
const DUMMY_FILES = {
  'sample-lab-report.json': JSON.stringify({
    _disclaimer: "SYNTHETIC DATA — Educational prototype only",
    reportType: "Complete Blood Count (CBC)",
    patientName: "Alice Johnson (DUMMY)",
    patientId: "DUMMY-P-001",
    reportDate: "2024-07-10",
    results: {
      WBC: "6.8 10^3/uL (Normal)",
      RBC: "4.7 10^6/uL (Normal)",
      Hemoglobin: "13.9 g/dL (Normal)",
      Platelets: "245 10^3/uL (Normal)"
    }
  }),
  'sample-prescription.json': JSON.stringify({
    _disclaimer: "SYNTHETIC DATA — Educational prototype only",
    documentType: "Prescription",
    prescriptionId: "RX-2024-005893",
    issuedDate: "2024-07-12",
    patientName: "Alice Johnson (DUMMY)",
    medications: [
      { name: "Amoxicillin (DUMMY)", dosage: "500mg", frequency: "3x daily", duration: "7 days" },
      { name: "Ibuprofen (DUMMY)", dosage: "400mg", frequency: "As needed" }
    ]
  })
};

// ─── SHA-256 Hash Utility (browser-native Web Crypto API) ────────────────────
// Produces a 0x-prefixed 64-character hex string — same format as Solidity bytes32.
async function sha256Hash(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Helper: Format Unix timestamp to readable date string ───────────────────
function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  return new Date(Number(ts) * 1000).toLocaleString();
}

// ─── Helper: Shorten a hash or address for display ───────────────────────────
function shortHash(hash) {
  if (!hash) return '';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

// =============================================================================
//  MAIN APP COMPONENT
// =============================================================================
function App() {
  // ── Wallet / Contract State ─────────────────────────────────────────────────
  const [account, setAccount]   = useState('');
  const [contract, setContract] = useState(null);
  const [mode, setMode]         = useState('patient'); // 'patient' | 'doctor'

  // ── UI Feedback ─────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('');
  const [error, setError]   = useState('');

  // ── Patient Dashboard State ─────────────────────────────────────────────────
  const [myRecords,    setMyRecords]    = useState([]);
  const [recordType,   setRecordType]   = useState('BloodTest');
  const [selectedFile, setSelectedFile] = useState('sample-lab-report.json');
  const [grantAddr,    setGrantAddr]    = useState('');
  const [revokeAddr,   setRevokeAddr]   = useState('');
  const [checkAddr,    setCheckAddr]    = useState('');
  const [checkResult,  setCheckResult]  = useState('');
  const [loading,      setLoading]      = useState(false);

  // ── Doctor Dashboard State ──────────────────────────────────────────────────
  const [patientAddr,    setPatientAddr]    = useState('');
  const [recordId,       setRecordId]       = useState('');
  const [accessedRecord, setAccessedRecord] = useState(null);
  const [accessDenied,   setAccessDenied]   = useState('');

  // ── Helper: set status or error ─────────────────────────────────────────────
  const ok  = msg => { setStatus(msg); setError('');   };
  const err = msg => { setError(msg);  setStatus('');  };

  // ── Show setup screen if deploy script hasn't been run yet ──────────────────
  if (!IS_CONFIGURED) {
    return <SetupScreen />;
  }

  // ── Connect MetaMask ────────────────────────────────────────────────────────
  async function connectWallet() {
    try {
      if (!window.ethereum) {
        err('MetaMask not found. Please install the MetaMask browser extension.');
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      const signer   = await provider.getSigner();
      const addr     = await signer.getAddress();
      const c        = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      setAccount(addr);
      setContract(c);
      ok(`Connected: ${addr}`);
    } catch (e) {
      err(`Wallet connection failed: ${e.message}`);
    }
  }

  // ── Load patient's own records from the contract ─────────────────────────────
  async function loadMyRecords() {
    if (!contract) return;
    try {
      const recs = await contract.getMyRecords();
      setMyRecords(recs);
    } catch (e) {
      err(`Error loading records: ${e.message}`);
    }
  }

  // Reload records when entering Patient mode
  useEffect(() => {
    if (contract && mode === 'patient') loadMyRecords();
  }, [contract, mode]);

  // ── Add a new medical record ─────────────────────────────────────────────────
  async function handleAddRecord() {
    if (!contract) return;
    setLoading(true);
    try {
      ok('Computing SHA-256 hash of selected file...');
      const fileContent = DUMMY_FILES[selectedFile];
      const hash        = await sha256Hash(fileContent);

      ok('Sending transaction to add record on-chain...');
      const tx = await contract.addRecord(account, hash, recordType, selectedFile);
      await tx.wait();

      ok(`✅ Record added! Type: ${recordType} | Hash: ${shortHash(hash)}`);
      await loadMyRecords();
    } catch (e) {
      err(`Add record failed: ${e.reason || e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Grant a doctor access ────────────────────────────────────────────────────
  async function handleGrantAccess() {
    if (!contract || !grantAddr.trim()) { err('Enter a doctor wallet address.'); return; }
    setLoading(true);
    try {
      ok('Sending grantAccess transaction...');
      const tx = await contract.grantAccess(grantAddr.trim());
      await tx.wait();
      ok(`✅ Access granted to ${grantAddr.trim()}`);
      setGrantAddr('');
    } catch (e) {
      err(`Grant access failed: ${e.reason || e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Revoke a doctor's access ─────────────────────────────────────────────────
  async function handleRevokeAccess() {
    if (!contract || !revokeAddr.trim()) { err('Enter a doctor wallet address.'); return; }
    setLoading(true);
    try {
      ok('Sending revokeAccess transaction...');
      const tx = await contract.revokeAccess(revokeAddr.trim());
      await tx.wait();
      ok(`✅ Access revoked from ${revokeAddr.trim()}`);
      setRevokeAddr('');
    } catch (e) {
      err(`Revoke access failed: ${e.reason || e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Check if an address currently has access ─────────────────────────────────
  async function handleCheckAccess() {
    if (!contract || !checkAddr.trim()) { err('Enter a doctor wallet address.'); return; }
    try {
      const result = await contract.hasAccess(account, checkAddr.trim());
      setCheckResult(
        result
          ? `✅ ${checkAddr.slice(0, 8)}... has access to your records.`
          : `❌ ${checkAddr.slice(0, 8)}... does NOT have access.`
      );
    } catch (e) {
      err(`Check failed: ${e.message}`);
    }
  }

  // ── Doctor: request access to a specific record ──────────────────────────────
  async function handleRequestAccess() {
    if (!contract)            { err('Connect wallet first.');           return; }
    if (!patientAddr.trim())  { err('Enter a patient address.');        return; }
    if (!recordId)            { err('Enter a record ID.');              return; }
    setAccessedRecord(null);
    setAccessDenied('');
    setLoading(true);
    try {
      ok('Calling requestRecordAccess — consent will be verified on-chain...');
      // This non-view call: (1) verifies consent, (2) emits RecordAccessed audit event
      const tx = await contract.requestRecordAccess(
        patientAddr.trim(),
        parseInt(recordId)
      );
      await tx.wait();
      ok('✅ Access authorized. Audit event logged on-chain.');

      // Fetch the record data for display using the view function
      // (doctor has consent so this will succeed)
      const rec = await contract.getRecord(parseInt(recordId));
      setAccessedRecord(rec);
    } catch (e) {
      const reason = e.reason || e.message || '';
      if (reason.includes('not authorized') || reason.includes('not granted consent')) {
        setAccessDenied('❌ Access Denied — This patient has not granted you consent to view their records.');
      } else if (reason.includes('does not exist')) {
        setAccessDenied('❌ Record Not Found — No record exists with this ID.');
      } else if (reason.includes('does not belong')) {
        setAccessDenied('❌ Wrong Patient — This record does not belong to the address you entered.');
      } else {
        setAccessDenied(`❌ Error: ${reason}`);
      }
      setStatus('');
    } finally {
      setLoading(false);
    }
  }

  // ─── PRE-CONNECT SCREEN ───────────────────────────────────────────────────
  if (!account) {
    return (
      <div className="app">
        <div className="connect-screen">
          <div className="logo">🏥</div>
          <h1>Decentralized Healthcare Data Exchange</h1>
          <p className="subtitle">Patient-controlled medical record access — powered by Ethereum blockchain</p>

          <div className="disclaimer-box">
            ⚠️ <strong>Educational Prototype Only</strong> — NOT HIPAA/GDPR Compliant.
            All data is 100% synthetic. Never use real patient information.
          </div>

          <button
            id="btn-connect-wallet"
            className="btn btn-primary btn-lg"
            onClick={connectWallet}
          >
            🦊 Connect MetaMask Wallet
          </button>

          {error && <div className="alert alert-error">{error}</div>}

          <p className="hint-small">
            Make sure MetaMask is connected to <strong>Hardhat Local Network</strong> (localhost:8545, Chain ID: 31337)
          </p>
        </div>
      </div>
    );
  }

  // ─── MAIN APP (after wallet connected) ───────────────────────────────────
  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-left">
          <span className="logo-sm">🏥</span>
          <span className="app-title">Healthcare Data Exchange</span>
          <span className="badge-prototype">Prototype</span>
        </div>
        <div className="header-right">
          <span className="wallet-badge">🦊 {account.slice(0, 6)}...{account.slice(-4)}</span>
          <div className="mode-toggle">
            <button
              id="btn-patient-mode"
              className={`tab-btn ${mode === 'patient' ? 'active' : ''}`}
              onClick={() => { setMode('patient'); setStatus(''); setError(''); }}
            >
              👤 Patient
            </button>
            <button
              id="btn-doctor-mode"
              className={`tab-btn ${mode === 'doctor' ? 'active' : ''}`}
              onClick={() => { setMode('doctor'); setStatus(''); setError(''); }}
            >
              🩺 Doctor
            </button>
          </div>
        </div>
      </header>

      {/* ── Global status / error banners ── */}
      {status && <div className="alert alert-success">{status}</div>}
      {error  && <div className="alert alert-error">{error}</div>}

      {/* ── Patient Dashboard ── */}
      {mode === 'patient' && (
        <main className="dashboard">
          <div className="dashboard-header">
            <h2>👤 Patient Dashboard</h2>
            <p className="address-display">Connected as: <code>{account}</code></p>
          </div>

          {/* My Records */}
          <section className="card">
            <div className="card-header">
              <h3>📋 My Medical Records</h3>
              <button id="btn-refresh-records" className="btn btn-sm" onClick={loadMyRecords}>
                ↻ Refresh
              </button>
            </div>
            {myRecords.length === 0 ? (
              <p className="empty-state">No records registered yet. Add one below.</p>
            ) : (
              <div className="table-wrapper">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Type</th>
                      <th>Off-Chain File</th>
                      <th>Document Hash</th>
                      <th>Uploaded By</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myRecords.map((r, i) => (
                      <tr key={i}>
                        <td>#{r.recordId.toString()}</td>
                        <td><span className="type-badge">{r.recordType}</span></td>
                        <td><code>{r.offchainReference}</code></td>
                        <td><code title={r.documentHash}>{shortHash(r.documentHash)}</code></td>
                        <td><code title={r.uploadedBy}>{r.uploadedBy.slice(0, 8)}...</code></td>
                        <td>{formatTimestamp(r.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Add Record */}
          <section className="card">
            <h3>➕ Add a Medical Record</h3>
            <p className="hint">
              Select a type and a simulated off-chain file. The app computes the file's
              SHA-256 hash using the browser's Web Crypto API and stores it on-chain.
              The actual file never leaves your machine.
            </p>
            <div className="form-grid">
              <label htmlFor="select-record-type">Record Type</label>
              <select
                id="select-record-type"
                value={recordType}
                onChange={e => setRecordType(e.target.value)}
              >
                <option>BloodTest</option>
                <option>Prescription</option>
                <option>XRay</option>
                <option>MRI</option>
                <option>DischargeSummary</option>
                <option>VaccinationRecord</option>
              </select>

              <label htmlFor="select-offchain-file">Simulated Off-Chain File</label>
              <select
                id="select-offchain-file"
                value={selectedFile}
                onChange={e => setSelectedFile(e.target.value)}
              >
                <option value="sample-lab-report.json">
                  sample-lab-report.json — CBC Blood Test (DUMMY)
                </option>
                <option value="sample-prescription.json">
                  sample-prescription.json — Prescription (DUMMY)
                </option>
              </select>
            </div>
            <button
              id="btn-add-record"
              className="btn btn-primary"
              onClick={handleAddRecord}
              disabled={loading}
            >
              🔗 Compute SHA-256 Hash &amp; Register Record On-Chain
            </button>
          </section>

          {/* Grant Access */}
          <section className="card">
            <h3>✅ Grant Doctor Access</h3>
            <p className="hint">
              Enter a doctor's wallet address. They will be able to access <strong>all</strong> your
              records until you revoke. This consent action is logged permanently on-chain.
            </p>
            <div className="input-row">
              <input
                id="input-grant-address"
                type="text"
                placeholder="Doctor wallet address (0x...)"
                value={grantAddr}
                onChange={e => setGrantAddr(e.target.value)}
              />
              <button
                id="btn-grant-access"
                className="btn btn-success"
                onClick={handleGrantAccess}
                disabled={loading}
              >
                Grant
              </button>
            </div>
          </section>

          {/* Revoke Access */}
          <section className="card">
            <h3>🚫 Revoke Doctor Access</h3>
            <p className="hint">
              Instantly revoke a doctor's access. Future <code>requestRecordAccess</code> calls
              from this address will be rejected by the contract. Revocation is also logged on-chain.
            </p>
            <div className="input-row">
              <input
                id="input-revoke-address"
                type="text"
                placeholder="Doctor wallet address (0x...)"
                value={revokeAddr}
                onChange={e => setRevokeAddr(e.target.value)}
              />
              <button
                id="btn-revoke-access"
                className="btn btn-danger"
                onClick={handleRevokeAccess}
                disabled={loading}
              >
                Revoke
              </button>
            </div>
          </section>

          {/* Check Access */}
          <section className="card">
            <h3>🔍 Check Doctor's Current Access Status</h3>
            <div className="input-row">
              <input
                id="input-check-address"
                type="text"
                placeholder="Doctor wallet address (0x...)"
                value={checkAddr}
                onChange={e => { setCheckAddr(e.target.value); setCheckResult(''); }}
              />
              <button
                id="btn-check-access"
                className="btn"
                onClick={handleCheckAccess}
              >
                Check
              </button>
            </div>
            {checkResult && <p className="check-result">{checkResult}</p>}
          </section>
        </main>
      )}

      {/* ── Doctor Dashboard ── */}
      {mode === 'doctor' && (
        <main className="dashboard">
          <div className="dashboard-header">
            <h2>🩺 Doctor Dashboard</h2>
            <p className="address-display">Connected as: <code>{account}</code></p>
          </div>

          <section className="card">
            <h3>🔐 Request Record Access</h3>
            <p className="hint">
              Enter a patient address and a record ID. The smart contract will verify whether
              this wallet has the patient's consent before returning any data.
              Every authorized access is <strong>permanently logged as a RecordAccessed event
              on-chain</strong> — this is the immutable audit trail.
            </p>
            <div className="form-col">
              <div className="form-grid">
                <label htmlFor="input-patient-address">Patient Wallet Address</label>
                <input
                  id="input-patient-address"
                  type="text"
                  placeholder="0x... patient's wallet address"
                  value={patientAddr}
                  onChange={e => { setPatientAddr(e.target.value); setAccessedRecord(null); setAccessDenied(''); }}
                />

                <label htmlFor="input-record-id">Record ID</label>
                <input
                  id="input-record-id"
                  type="number"
                  min="1"
                  placeholder="e.g. 1"
                  value={recordId}
                  onChange={e => { setRecordId(e.target.value); setAccessedRecord(null); setAccessDenied(''); }}
                />
              </div>

              <button
                id="btn-request-access"
                className="btn btn-primary"
                onClick={handleRequestAccess}
                disabled={loading}
              >
                🔑 Request Record Access (Audit Event Will Be Logged On-Chain)
              </button>
            </div>
          </section>

          {/* Access Denied */}
          {accessDenied && !accessedRecord && (
            <section className="card card-denied">
              <h3>Access Result</h3>
              <div className="denied-box">{accessDenied}</div>
              <p className="hint">The patient must call <code>grantAccess(yourAddress)</code> first.</p>
            </section>
          )}

          {/* Access Granted — Show Record */}
          {accessedRecord && !accessDenied && (
            <section className="card card-granted">
              <h3>✅ Access Authorized — Record Details</h3>
              <div className="record-detail">
                <div className="field"><span className="label">Record ID</span>       <span>#{accessedRecord.recordId.toString()}</span></div>
                <div className="field"><span className="label">Type</span>            <span className="type-badge">{accessedRecord.recordType}</span></div>
                <div className="field"><span className="label">Patient</span>         <code>{accessedRecord.patientAddress}</code></div>
                <div className="field"><span className="label">Uploaded By</span>     <code>{accessedRecord.uploadedBy}</code></div>
                <div className="field"><span className="label">Off-Chain File</span>  <code>{accessedRecord.offchainReference}</code></div>
                <div className="field"><span className="label">Document Hash</span>   <code className="long-hash">{accessedRecord.documentHash}</code></div>
                <div className="field"><span className="label">Registered At</span>   <span>{formatTimestamp(accessedRecord.timestamp)}</span></div>
              </div>
              <div className="audit-note">
                ℹ️ This access has been permanently logged as a <code>RecordAccessed</code> event
                on the blockchain. It cannot be deleted or altered.
              </div>
            </section>
          )}
        </main>
      )}

      <footer className="app-footer">
        ⚠️ Educational Prototype — NOT HIPAA/GDPR Compliant — Synthetic Data Only &nbsp;|&nbsp;
        Contract: <code>{CONTRACT_ADDRESS.slice(0, 10)}...{CONTRACT_ADDRESS.slice(-6)}</code>
      </footer>
    </div>
  );
}

// =============================================================================
//  SETUP SCREEN (shown when contract-config.js is not yet populated)
// =============================================================================
function SetupScreen() {
  return (
    <div className="app">
      <div className="connect-screen">
        <div className="logo">⚙️</div>
        <h1>Setup Required</h1>
        <p className="subtitle">The contract has not been deployed yet.</p>
        <div className="setup-steps">
          <p>Run these commands in your terminal:</p>
          <ol>
            <li>
              <span className="step-label">Terminal 1 — Start local blockchain:</span>
              <code className="code-block">npx hardhat node</code>
            </li>
            <li>
              <span className="step-label">Terminal 2 — Deploy the contract:</span>
              <code className="code-block">npm run deploy</code>
            </li>
            <li>
              <span className="step-label">Import a test wallet into MetaMask</span>
              <p className="step-note">
                Copy a private key from the hardhat node output and import it
                into MetaMask. Set network to <strong>Localhost 8545</strong>, Chain ID <strong>31337</strong>.
              </p>
            </li>
            <li>
              <span className="step-label">Then refresh this page</span>
            </li>
          </ol>
        </div>
        <div className="disclaimer-box">
          ⚠️ Educational Prototype Only — NOT HIPAA/GDPR Compliant — Synthetic Data Only
        </div>
      </div>
    </div>
  );
}

export default App;
