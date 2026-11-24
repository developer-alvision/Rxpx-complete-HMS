# RxPX HMS Implementation Plan

## Phase 1: Complete Existing Project Audit (DONE)
- [x] Audit report created (AUDIT_REPORT.md)
- [x] Existing architecture documented
- [x] Database schema analyzed
- [x] Login-by-login functionality assessed
- [x] CRUD operation matrix created
- [x] Cross-login connection matrix created
- [x] Security assessment completed
- [x] Missing functionality identified
- [x] Critical bugs documented
- [x] Recommended migration strategy outlined

## Phase 2: Shared Database Architecture & Encounter Management
- [x] Add encounterId generation on patient registration (patients.js)
- [x] Add real-time listener in doctor-dashboard.js for new patients from Reception
- [x] Add renderNewPatientQueue and startConsultationFromQueue functions
- [x] Verify encounterId propagation to all related records
- [x] Add encounterId to consultation, prescription, and bill records

## Phase 3: Doctor Prescription → Pharmacy + Reception Integration
- [x] When prescription is saved, auto-add items to reception's current bill inbox
- [x] Pharmacy queue already listens to prescriptions collection ✓
- [x] Need: Prescription save → update patient's open bill with prescription items
- [x] Need: Reception bill auto-update when new prescription added

## Phase 4: Doctor Lab Order → Laboratory + Reception Integration
- [x] When lab tests are ordered (reports created), auto-add items to reception's current bill inbox
- [x] Laboratory queue already receives reports during consultation ✓
- [x] Need: Lab order save → update patient's open bill with test items
- [x] Need: Reception bill auto-update when new lab order added

## Phase 5: Central Billing & Payment Engine
- [x] Ensure one authoritative billing engine - bills flow from single source
- [x] Payment status independent from service status
- [x] Payment authorization validated by trusted backend logic
- [x] Idempotency protection on all payment operations
- [x] Bill cancellation with audit history
- [x] Refund processing with audit trail
- [x] Split payment support
- [x] Daily collection reports

## Phase 6: Pharmacy Dispensing → Reception Status
- [x] When medicines dispensed, update reception bill status (`updateReceptionBillAfterDispense`)
- [ ] Dispatch record includes: quantity dispensed, remaining, status
- [ ] Patient-facing bills show selling price only
- [ ] Internal purchase price restricted to authorized users

## Phase 7: Laboratory Result Lifecycle
- [ ] Full lifecycle: ORDERED → PAYMENT PENDING → AUTHORIZED → SAMPLE COLLECTED → IN PROGRESS → RESULT ENTERED → VERIFIED → RELEASED → COMPLETED
- [ ] Configurable emergency/credit authorization
- [ ] Result verification by authorized users only
- [ ] Result release → Doctor view + Reception document desk
- [ ] Amended results preserve original versions + audit history
- [ ] Result units, reference ranges, abnormal value identification

## Phase 8: Reception Document Desk & Certificates
- [ ] Approved reports appear in Reception's document desk
- [ ] Reception can print/issue approved reports and certificates
- [ ] Document issue and reprint history maintained
- [ ] Certificate issuance workflow with audit logging

## Phase 9: Cross-Login Real-Time Synchronization
- [ ] Reception registration → Doctor queue ✓ (partially)
- [ ] Doctor prescription → Pharmacy queue + Reception billing (in progress)
- [ ] Doctor test order → Laboratory queue + Reception billing (in progress)
- [ ] Reception payment → Pharmacy authorization + Laboratory authorization
- [ ] Pharmacy dispensing → Reception status + permitted Doctor view
- [ ] Laboratory result release → Doctor result section + Reception document desk
- [ ] Admin configuration changes → Relevant authorized modules

## Phase 10: Security & Permission Enforcement
- [x] Backend/database authorization on all sensitive operations
- [x] Role-based access control at Firestore level
- [x] Input validation on all server-side operations
- [x] Audit logging on all critical actions
- [x] Permission checks enforced backend (not just frontend)
- [x] Test unauthorized direct API/database requests (11 backend security tests passing)

## Phase 11: Testing - End-to-End Validation
- [ ] TEST 1: Reception creates patient + encounter → Doctor sees same patient/encounter ✓
- [ ] TEST 2: Doctor creates prescription → Pharmacy receives it + Reception receives billable items
- [ ] TEST 3: Doctor creates lab order → Laboratory receives it + Reception receives billable items
- [ ] TEST 4: Reception collects payment → Payment saved once → Relevant department receives authorization
- [ ] TEST 5: Unpaid orders cannot proceed unless authorized exception exists
- [ ] TEST 6: Laboratory enters and verifies result → Doctor receives released result
- [ ] TEST 7: Reception accesses and prints approved report
- [ ] TEST 8: Pharmacy partially dispenses medicine → Reception sees actual dispensed and remaining
- [ ] TEST 9: Unauthorized roles cannot update or delete protected records
- [ ] TEST 10: Payment retry/double-click does not create duplicate transactions
- [ ] TEST 11: Catalogue price changes do not alter historical invoices
- [ ] TEST 12: Order cancellation, refund, amended results and document reprints preserve audit history
- [ ] TEST 13: Multiple simultaneous users no duplicate transactions or data overwrite
- [ ] TEST 14: Network failure/retry no duplicate records or lost updates
- [ ] TEST 15: Complete patient journey from registration through final report delivery

## Phase 12: Deployment readiness
- [ ] Fill Firebase config with actual project values
- [ ] Set up Firebase secrets (Razorpay, AI Sensy, etc.)
- [ ] Firestore rules review and deployment
- [ ] Rollback plan documentation
- [ ] Performance and load testing
- [ ] Backup and disaster recovery setup