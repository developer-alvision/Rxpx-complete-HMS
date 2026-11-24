# Hospital Management System - Technical Audit Report
## Phase Zero: Complete Existing Project Audit

**Date**: November 23, 2026  
**Project**: RxPX HMS (Hospital Management System)  
**Location**: C:\Users\admin\Desktop\RxPX HMS

---

## 1. EXISTING ARCHITECTURE

### 1.1 Frontend Application
- **Framework**: Vanilla JavaScript (no React/Vue/Angular)
- **Structure**: 70+ JS files in `C:\Users\admin\Desktop\js\`
- **UI Library**: Font Awesome icons, custom CSS variables
- **Build System**: None - files served directly
- **Responsive**: Mobile-responsive design with flex/grid layouts
- **Key Modules**:
  - `patients.js` - Patient registration, search, editing
  - `consultation.js` - Doctor consultation, prescription, diagnostics
  - `pharmacy.js` - Medicine dispensing, inventory, GRN
  - `lab-reports.js` - Lab test entry, verification, result release
  - `billing.js` - Bill management, payments, refunds
  - `admin.js` - User/role/department management
  - `hospital-policy.js` - Fee structure, lab/imaging catalogue
  - `appointments.js` - Appointment scheduling, token management

### 1.2 Backend (Firebase Functions)
- **Runtime**: Node.js with Firebase Admin SDK
- **Region**: asia-south1
- **Entry Points**: Cloud Functions (onCall, onRequest, onSchedule)
- **Key Functions**:
  - `applyHospitalPolicy` - Pushes policy to Firestore service catalog
  - `issueHospitalCertificate` - Certificate issuance with audit
  - `verifyRazorpayPayment` - Payment verification and bill update
  - `createRazorpayOrder` - Razorpay payment order creation
  - `syncStaffUid` - Staff UID synchronization
  - `scheduledFirestoreExport` - Nightly backup
  - `sendBillWhatsApp`, `sendBillEmail` - Communication
  - `calendarFeed` - Google Calendar integration
  - `abdmRequestOtp`, `abdmVerifyAndLink` - ABHA/ABDM integration

### 1.3 Database (Firestore)
- **Structure**: Collection-based NoSQL
- **Security**: Firestore Security Rules (not inspected in detail)
- **Key Collections**:
  - `patients` - Patient demographic records
  - `patientIndex` - Phone-to-patient lookup index
  - `consultations` - Clinical consultation records
  - `appointments` - Scheduled appointment slots
  - `opTokens` - Doctor waiting queue tokens
  - `bills` - billing records (main + patient subcollection)
  - `prescriptions` - Medicine prescriptions
  - `reports` - Lab/imaging reports
  - `pharmacy` - Medicine inventory
  - `stockReceipts` - Stock GRN receipts
  - `auditLog` - Audit trail for critical actions
  - `hospitalSettings` - Configuration (hospital name, policy version, integrations)
  - `staff` - Staff accounts with roles/departments
  - `departments` - Department definitions
  - `serviceCatalog` - Price catalogue (JYO- prefixed)
  - `billCounters` - Sequential bill number generation
  - `paymentAttempts` - Razorpay payment attempt tracking
  - `certificates`, `certificateCounters` - Certificate issuance
  - `backupLog` - Export backup log

### 1.4 Firebase Configuration
- **Status**: `js/firebase-config.js` has empty values (apiKey, authDomain, projectId, etc.)
- **Behavior**: On localhost, app uses Firebase emulators; config needed for production
- **Region**: `window.FIREBASE_REGION = 'asia-south1'`

### 1.5 Authentication
- **Provider**: Firebase Authentication (email/password likely)
- **Role Assignment**: Staff documents in `/staff/{uid}` with `role` field
- **Role Check**: Both frontend `checkAccess()` and backend `requireRole()` validate permissions
- **Current Roles**: admin, owner, doctor, nurse, receptionist, billing_staff, pharmacist, lab_technician

### 1.6 UI Framework
- **Design Language**: Custom with CSS variables (--primary-navy, --error-color, etc.)
- **Components**: Modals, tables, dropdowns, badges, badges
- **Printing**: PDF generation functions referenced but may not be fully implemented
- **Error Handling**: `showToast()` for user messages, `console.error` for dev

---

## 2. DATABASE SCHEMA ANALYSIS

### 2.1 Core Entities and Relationships

| Entity | Key Fields | Relationships | Comments |
|--------|-----------|---------------|----------|
| **patients** | `patientId`, `name`, `phone`, `dob`, `gender`, `status` | 1:N `patientIndex`, N:1 `bills`, N:M `consultations` via `patientId` | `patientIndex` by phone for duplicate detection |
| **patientIndex** | `phone` -> `patientId`, `docId` | Index for fast phone lookup | Critical for duplicate prevention |
| **consultations** | `consultationId`, `patientId`, `doctorId`, `status`, `billDocId` | N:1 `patients`, 1:N `bills`, 1:N `reports`, 1:N `prescriptions` | Central clinical record |
| **appointments** | `appointmentId`, `patientId`, `doctorId`, `status`, `tokenNumber` | N:1 `patients`, N:1 `opTokens` | Queue management |
| **opTokens** | `tokenId`, `patientId`, `status`, `date`, `tokenNo` | N:1 `consultations` | Doctor queue visible to reception |
| **bills** | `billId`, `patientId`, `grandTotal`, `balanceDue`, `paymentStatus`, `items` | N:1 `patients`, 1:N `payments` (subcollection), 1:N `auditLog` | Central financial record |
| **bills (patient subcollection)** | `billDocId` -> bill data | Per-patient bill history | Parallel storage |
| **prescriptions** | `prescriptionId`, `patientId`, `doctorName`, `medicines`, `status` | N:1 `patients`, 1:N `payments` via billing | Doctor -> Pharmacy routing |
| **reports** | `reportId`, `patientId`, `testName`, `amount`, `status`, `billingStatus`, `linkedBillId` | N:1 `patients`, 1:1 `bills` via `linkedBillId` | Lab results flow |
| **pharmacy** | `medicineId`, `medicineName`, `stock`, `price`, `batchNo`, `expiryDate` | N:M `prescriptions` via dispensing | Inventory + dispensing |
| **auditLog** | `action`, `recordId`, `userId`, `role`, `timestamp`, `previousValue`, `newValue` | N:1 all actions | Immutable audit trail |
| **hospitalSettings** | `hospitalName`, `policyVersion`, `fees`, `integrations` | 1:1 config | Global configuration |
| **staff** | `uid`, `name`, `role`, `department`, `isActive`, `opFee`, `freeOP` | 1:1 staff account | Role-based access |

### 2.2 Identifier Standards (Partially Implemented)
- `patient_id` - Present as `patientId` in most records
- `encounter_id` - **Missing** / Not consistently used
- `user_id` - Present as `uid` in staff, but not always on clinical records
- `doctor_id` - Present as `doctorId` / `doctorName`
- `prescription_id` - Present as `prescriptionId` in prescriptions collection
- `investigation_order_id` - **Partially present** in reports
- `invoice_id` - Present as `billId`
- `payment_id` - **Present** in paymentAttempts, but not consistently linked
- `lab_result_id` - Present as `reportId`
- `dispensing_id` - **Missing** / Not consistently tracked
- `document_id` - Present as `certificateNo` / `reportId`

**Issue**: Many records use names or partial identifiers instead of proper foreign keys. The audit must enforce proper `patient_id` and `encounter_id` on all records.

---

## 3. LOGIN-BY-LOGIN FUNCTIONALITY

### 3.1 Reception Module
**Status**: PARTIALLY WORKING - UI exists but backend integration incomplete

| Feature | Status | Notes |
|---------|--------|-------|
| Patient search | Working | Search by patientId, name, phone |
| Register new patient | Working | Duplicate phone detection exists |
| Prevent duplicate registrations | Partial | Phone check works, but race condition possible |
| Edit patient demographics | Working | Edit form exists, transaction save exists |
| View patient history | Working | Previous consultations loaded |
| Generate patient ID | Working | `generatePatientId()` uses counter collection |
| Generate encounter number | **Missing** | No encounter number generation |
| Create new encounter | **Missing** | No encounter creation on registration |
| View queue (doctor assignment) | Partial | Doctors loaded, but queue not visible from reception |
| Central billing | Partial | Bill creation exists, but auto-population from orders missing |
| Payment collection | Partial | Payment UI exists, but transaction atomicity needs work |
| Document desk (approved reports) | Partial | Reports loaded, but approval workflow unclear |

### 3.2 Doctor Module
**Status**: PARTIALLY WORKING - Consultation workflow functional but downstream routing weak

| Feature | Status | Notes |
|---------|--------|-------|
| Patient queue | Working | Loads patients by patientId |
| Patient record access | Working | Load patient by patientId |
| Consultation (chief complaint, diagnosis, etc.) | Working | Full form with validation |
| Prescription management | Working | Save prescription routes to `/prescriptions` |
| Investigation ordering | Working | Lab/imaging orders saved to `/reports` |
| Lab result review | Partial | Reports loaded, but verification/release workflow weak |
| **Never modify Reception payment records** | **Not enforced** | Frontend only; backend has no constraint |

### 3.3 Laboratory Module
**Status**: BASIC - Lab entry exists but full lifecycle incomplete

| Feature | Status | Notes |
|---------|--------|-------|
| Receive investigation orders | Partial | Reports created during consultation, but dedicated queue missing |
| Sample collection tracking | **Missing** | No sample collection status tracking |
| Result entry | Working | `enterLabResults()` function exists |
| Result verification | **Missing** | No verify/release workflow with permissions |
| Report release | Partial | Results can be entered, but "verified → released" flow incomplete |
| Result appears in doctor view | Partial | Dependencies on consultation ID |
| Preserve original versions/audit history | **Not implemented** | No versioning on amended results |

### 3.4 Pharmacy Module
**Status**: WORKING - Dispensing functional but integration with consultation weak

| Feature | Status | Notes |
|---------|--------|-------|
| Receive prescriptions automatically | Partial | Prescriptions saved to `/prescriptions` but not auto-routed |
| Check medicine availability | Working | Real-time Firestore listener |
| Record actual quantity dispensed | Working | `dispenseMedicine()` atomic stock deduction |
| Record partial dispensing | Working | Quantity tracking exists |
| Record unavailable medicines | Working | Stock validation before dispatch |
| Record batch number | Working | GRN/Stock management |
| Record expiry date | Working | Expiry date tracking |
| Update stock when inventory enabled | Working | Transactional stock update |
| View dispensing history | Working | History drawer and reports |

### 3.5 Admin Module
**Status**: WORKING - Configuration functional

| Feature | Status | Notes |
|---------|--------|-------|
| User management | Working | CRUD on staff records |
| Role configuration | Working | Role field on staff documents |
| Permission configuration | Partial | Frontend `checkAccess()` only; backend rules not verified |
| Department management | Working | Hospital policy pushes departments |
| Service catalogues | Working | `applyHospitalPolicy` populates serviceCatalog |
| Prices management | Working | Fee structure in hospital-policy.js |
| Templates management | Working | Certificate templates exist |
| Audit logs | Working | `auditLog` collection populated |
| Backend security | **Not verified** | Firestore rules not inspected |

---

## 4. CRUD OPERATIONS MATRIX

### 4.1 Reception CRUD

| Entity | Create | Read | Update | Delete/Void |
|--------|--------|------|--------|-------------|
| **Patients** | ✅ (with duplicate check) | ✅ | ✅ (permitted fields) | ❌ (soft delete only) |
| **Encounters** | ❌ (not implemented) | ✅ (if exist) | ❌ (not implemented) | ❌ |
| **Bills** | ✅ (from consultation) | ✅ | ✅ (authorized void/partial) | ✅ (cancel with audit) |
| **Payments** | ✅ (cash/UPI/card) | ✅ | ⚠️ (authorized refund only) | ❌ (permanent deletion) |
| **Documents** | ⚠️ (generate) | ✅ | ❌ (issue approved only) | ❌ |

### 4.2 Doctor CRUD

| Entity | Create | Read | Update | Cancel/Discontinue |
|--------|--------|------|--------|-------------------|
| **Patients** | ❌ | ✅ (read-only) | ❌ | ❌ |
| **Encounters** | ❌ | ✅ | ❌ | ❌ |
| **Consultations** | ✅ (draft/completed) | ✅ | ✅ (amend draft) | ❌ (cancel before complete) |
| **Prescriptions** | ✅ | ✅ | ✅ (amend) | ✅ (discontinue with audit) |
| **Investigation orders** | ✅ | ✅ | ✅ (cancel) | ✅ (cancel) |
| **Lab results** | ❌ | ✅ (read only) | ❌ (doctors MUST NOT modify) | ❌ |

### 3.3 Laboratory CRUD

| Entity | Create | Read | Update | Verify/Release |
|--------|--------|------|--------|----------------|
| **Patients** | ⚠️ (min info) | ✅ | ❌ | ❌ |
| **Investigation orders** | ✅ | ✅ | ✅ (amend before verify) | ❌ |
| **Samples** | ✅ | ✅ | ✅ | ❌ |
| **Results** | ✅ (enter) | ✅ | ✅ (amend before verify) | ✅ (authorized users only) |

### 3.4 Pharmacy CRUD

| Entity | Create | Read | Update | Delete/Cancel |
|--------|--------|------|--------|---------------|
| **Patients** | ⚠️ (min info) | ✅ | ❌ | ❌ |
| **Prescriptions** | ✅ (from doctor) | ✅ | ✅ (amend status) | ⚠️ (dispense only once) |
| **Dispensing** | ✅ | ✅ | ✅ (update status) | ❌ (permanent deletion) |
| **Inventory** | ✅ (GRN) | ✅ | ✅ (stock adjust, audited) | ❌ (dispose with reason) |

### 3.5 Admin CRUD

| Entity | Create | Read | Update | Deactivate |
|--------|--------|------|--------|-----------|
| **Users** | ✅ (staff records) | ✅ | ✅ | ✅ (soft deactivate) |
| **Roles** | ✅ | ✅ | ✅ | ❌ |
| **Permissions** | ✅ (configure) | ✅ | ✅ | ❌ |
| **Departments** | ✅ | ✅ | ✅ | ❌ |
| **Service catalogues** | ✅ | ✅ | ✅ | ❌ |
| **Prices** | ✅ | ✅ | ✅ | ❌ (historical invoices protected) |
| **Templates** | ✅ | ✅ | ✅ | ❌ |
| **Audit logs** | ✅ (read only) | ✅ | ❌ (immutable) | ❌ |

---

## 5. CROSS-LOGIN CONNECTION MATRIX

### 5.1 Data Flow Analysis

| From → To | Data Flow | Status | Gap |
|-----------|-----------|--------|-----|
| **Reception registration → Doctor queue** | `patients` collection real-time listener should populate doctor queue | Partial | Queue visible but not automatically after registration; encounter number missing |
| **Doctor prescription → Pharmacy queue** | `prescriptions` collection → `pharmacy` queue | Partial | Prescriptions saved but not auto-notified to pharmacy; pharmacy must manually load |
| **Doctor test order → Laboratory queue** | `reports` collection during consultation → lab work queue | Partial | Reports created but dedicated "investigation queue" not implemented |
| **Reception payment → Pharmacy authorization** | Payment status update → pharmacy stock/check | Weak | No backend validation that payment must be recorded before dispensing |
| **Pharmacy dispensing → Reception status** | Dispensing record → bill items | Partial | Dispatch creates bill items but reconciliation tenuous |
| **Laboratory result release → Doctor view** | Report status change → consultation report section | Partial | Results entered but "verified → released" → "doctor sees" flow broken |
| **Laboratory result release → Reception document desk** | Released reports → reception document desk | Weak | No mechanism for approved reports to appear in reception desk |
| **Admin config changes → Modules** | Hospital policy → service catalog, fees | Working | Policy applied, but frontend caches may stale |

### 5.2 Identifier Propagation Issues

| Identifier | Should propagate from | Currently propagates to | Gap |
|------------|----------------------|------------------------|-----|
| `patient_id` | Registration → All modules | Mostly working but inconsistent | Some records use names instead |
| `encounter_id` | Registration/First visit → All modules | **NOT implemented** | Critical gap - no encounter numbers |
| `consultation_id` | Doctor consultation → All modules | Working via URL param and Firestore | But not linked to reception billing automatically |
| `prescription_id` | Doctor prescription → Pharmacy + Reception | Partially | Pharmacy must search; not auto-routed |
| `investigation_order_id` | Doctor test order → Laboratory + Reception | Partially | Reports created but not routed as "orders" |
| `bill_id` | Central billing → All modules | Working | But items may be manually re-entered |
| `payment_id` | Payment collection → All modules | Weak | No consistent linking to source orders |

---

## 6. SECURITY ASSESSMENT

### 6.1 Strengths
- Backend `requireRole()` functions enforce role checks on all Cloud Functions
- Firestore Security Rules (not inspected but referenced)
- Audit logging on critical actions
- Staff UID synchronization prevents impersonation
- Sensitive secrets stored in Firebase Functions secrets (not in code)

### 6.2 Vulnerabilities
1. **Frontend-only security**: `checkAccess()` in every JS file - easily bypassed by direct API calls
2. **No backend validation on critical CRUD**: Editing a bill or prescription via direct Firestore write bypasses all checks
3. **Duplicate prevention race conditions**: Phone check in JS, but could have concurrent registrations
4. **Payment idempotency**: No protection against double-payment submissions
5. **Stock deduction race conditions**: Multiple dispenses could oversell inventory
6. **Unprotected collections**: Some Firestore collections may have insufficient rules
7. **No input sanitization guarantees**: Patient names, IDs passed directly to database
8. **CSRF potential**: No session validation beyond Firebase auth token

### 6.3 Security Recommendations
- **Backend enforcement**: Every sensitive operation must have backend validated endpoint or callable
- **Firestore Rules**: Audit all collections; ensure role-based access at document level
- **Idempotency keys**: On all payment/dispensing/ order submissions
- **Input validation**: Server-side schema validation on all writes
- **Audit log integrity**: Prevent deletion/alteration of audit entries
- **Session management**: Re-authenticate on sensitive operations

---

## 7. MISSING FUNCTIONALITY

### 7.1 Critical Gaps
1. **No encounter number generation** - Patients registered but no unique visit/encounter ID
2. **No automatic cross-login routing** - Doctor prescriptions not auto-routed to pharmacy/lab; reception must manually collect
3. **No encounter-based patient tracking** - All records patient-based, not encounter-based
4. **No bill auto-generation from orders** - Pharmacy/lab charges must be manually added to reception bills
5. **No payment idempotency** - Double-click or retry could create duplicate payments
6. **No lab result verification workflow** - Entered results not verified/released with audit
7. **No document approval workflow** - Approved reports/certificates not gated by approval status
8. **No split/partial payment support** - Payment status field combines service status with payment status
9. **No soft deletion** - Critical records permanently deletable
10. **No audit history preservation** - Amendments/cancellations don't preserve previous values

### 7.2 UI/UX Gaps
1. No loading states during real-time data sync
2. Error states not gracefully handled in all flows
3. No offline experience beyond basic IndexedDB
4. Print layouts not implemented for all document types
5. Responsive design issues on some modules

### 7.3 Reporting Gaps
1. No daily collection reports
2. No department-wise pending work reports
3. No user activity summaries
4. No certificate issuance analytics
5. No pharmacy stock movement reports

---

## 8. CRITICAL BUGS

### 8.1 Functional Bugs
1. **Duplicate patient registration possible under race conditions** - Phone check not transactional
2. **Consultation downstream writes not atomic** - If prescription save fails, consultation may mark as completed without bill
3. **Pharmacy stock deduction not consistently transactional** - `commitPharmacySale` in test harness expects atomicity
4. **Lab result amend has no audit trail** - Amended results lose original version
5. **Bill cancellation not reversible** - Once cancelled, no refund workflow with audit
6. **No encounter ID anywhere in data model** - Critical for visit tracking
7. **Payment status conflated with service status** - Single `paymentStatus` field used for both payment and service state
8. **Pharmacy cannot distinguish internal purchase price from patient bill price** - Both use same `price` field

### 8.2 Integration Bugs
1. **Doctor → Pharmacy routing missing** - Prescription saved to DB but pharmacy queue not triggered
2. **Doctor → Lab routing incomplete** - Test orders saved but lab queue not populated
3. **Reception billing inbox not populated automatically** - Must manually add items from prescriptions/tests
4. **Payment → Department authorization not implemented** - Payment recorded but no department notification
5. **Pharmacy dispensing status not fed back to reception** - Reception sees old bill state

### 8.3 Security Bugs
1. **`checkAccess()` can be bypassed** - Direct Firestore/write API calls bypass frontend checks
2. **No backend validation on patient edit** - Any authenticated user could potentially edit any patient
3. **No rate limiting on duplicate checks** - No protection against brute-force registration
4. **Staff role can be set arbitrarily** - Frontend sets role but backend `requireRole()` may not cover all paths

---

## 9. RECOMMENDED MIGRATION STRATEGY

### Phase 1: Shared Database Architecture (Weeks 1-2)
1. Fill in Firebase config with actual project values
2. Ensure all Firestore documents use consistent `patientId`, `encounterId` fields
3. Add `encounterId` generation on patient registration
4. Implement transactions for all critical CRUD operations

### Phase 2: Permission & Security (Weeks 3-4)
1. Audit and fix Firestore Security Rules
2. Move all sensitive CRUD to Cloud Functions/onCall endpoints
3. Implement idempotency protection on payments/dispensing/orders
4. Add audit logging to all write operations
5. Enforce soft deletion with restore capability

### Phase 3: Reception Integration (Weeks 5-6)
1. Implement encounter number generation
2. Auto-route prescriptions to pharmacy queue
3. Auto-route investigation orders to lab queue
4. Auto-populate reception billing from source orders
5. Implement payment collection with transaction protection

### Phase 4: Laboratory & Pharmacy (Weeks 7-8)
1. Implement full lab result lifecycle (ordered → verified → released)
2. Implement dispensing status feedback to reception
3. Separate internal purchase price from patient bill price
4. Implement document approval workflow

### Phase 5: Admin & Reporting (Weeks 9-10)
1. Complete admin CRUD with proper permissions
2. Implement all required reports
3. Add dashboard clarity for all departments
4. Implement daily collection and outstanding payment reports

### Phase 6: End-to-End Testing (Weeks 11-12)
1. Run all 15 mandatory tests
2. Fix any failing tests
3. Perform complete patient journey validation
4. Security penetration testing
5. Performance and load testing

### Phase 7: Deployment Preparation (Weeks 13-14)
1. Configure Firebase production project
2. Set up secrets (Razorpay, AI Sensy, etc.)
3. Firestore rules review and deployment
4. Rollback plan documentation
5. Training and documentation

---

## 10. IMMEDIATE NEXT STEPS

1. **Fill Firebase config** in `js/firebase-config.js` with actual project values
2. **Run existing test suite** to identify current pass/fail status
3. **Fix Firebase Security Rules** to enforce role-based access
4. **Add `encounterId` field** to patient registration and all related records
5. **Implement transaction protection** on all payment, dispensing, and order operations
6. **Start with Phase 1** of the migration strategy

---

*End of Audit Report*