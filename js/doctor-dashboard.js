// ==========================================
// RXPX HMS - CLINICIAN PORTAL JS
// ==========================================

checkAccess(['doctor', 'admin']);

let currentDoctorName = '';
let currentDoctorId = '';
let currentDoctorDept = 'General';
let currentDoctor = null;
let currentUserEmail = '';

let selectedPatient = null;
let allTodayAppointments = [];

// Page Initialization
getCurrentUser((user) => {
    if (!checkPageAccess(user)) return;
    currentUserEmail = user.email || '';
    
    // Load current doctor profile
    db.collection('staff').where('email', '==', currentUserEmail).get().then(snap => {
        if (snap.empty) {
            showToast('Clinician profile not found.', 'error');
            return;
        }
        
        const doc = snap.docs[0];
        currentDoctor = { id: doc.id, ...doc.data() };
        currentDoctorName = currentDoctor.name;
        currentDoctorId = doc.id;
        currentDoctorDept = currentDoctor.department || 'General';
        
        // Render welcome text
        let displayName = currentDoctorName || '';
        if (displayName && !displayName.toLowerCase().startsWith('dr.')) {
            displayName = 'Dr. ' + displayName;
        }
        document.getElementById('doctorWelcome').textContent = `Welcome, ${displayName}`;

        // Designation line + areas of expertise chips (from the doctor record)
        const desigEl = document.getElementById('doctorDesignation');
        if (desigEl) {
            desigEl.textContent = [currentDoctor.specialisation, currentDoctor.department]
                .filter(Boolean).join(' · ') || 'Your clinic at a glance.';
        }
        const servicesEl = document.getElementById('doctorServices');
        if (servicesEl && Array.isArray(currentDoctor.services) && currentDoctor.services.length) {
            servicesEl.innerHTML = currentDoctor.services.map(function (s) {
                return '<span style="font-size:11px; font-weight:600; color:var(--primary-teal-hover); background:var(--primary-light); border:1px solid rgba(253,99,11,0.18); padding:3px 9px; border-radius:999px;">' + escapeHtml(s) + '</span>';
            }).join('');
        }
        
        // Pre-fill locked doctor fields in booking form
        document.getElementById('bookingDoctorName').value = currentDoctorName;
        document.getElementById('bookingDoctorId').value = currentDoctorId;
        document.getElementById('bookingDept').value = currentDoctorDept;
        document.getElementById('bookingDate').value = todayIso();
        
        // Set queue date subtitle
        document.getElementById('queueDate').textContent = formatDate(new Date());
        
        // Run Real-Time Data Listeners
        runDashboardListeners();
        
    }).catch(err => {
        console.error('Error fetching doctor details:', err);
        showToast('Error initializing dashboard.', 'error');
    });
});

// ==========================================
// 1. DASHBOARD SYNC LISTENERS
// ==========================================
function runDashboardListeners() {
    const todayStr = todayIso();
    
    // Listener 1: Today's Appointments
    db.collection('appointments')
        .where('doctorId', '==', currentDoctorId)
        .where('appointmentDate', '==', todayStr)
        .onSnapshot(snapshot => {
            allTodayAppointments = [];
            let total = 0;
            let waiting = 0;
            let completed = 0;
            
            snapshot.forEach(doc => {
                const appt = { id: doc.id, ...doc.data() };
                allTodayAppointments.push(appt);
                
                total++;
                const status = (appt.status || 'scheduled').toLowerCase();
                if (status === 'scheduled' || status === 'waiting' || status === 'in_progress') {
                    waiting++;
                } else if (status === 'completed') {
                    completed++;
                }
            });
            
            // Set Widgets
            document.getElementById('cardTodayAppointments').textContent = total;
            document.getElementById('cardWaitingPatients').textContent = waiting;
            document.getElementById('cardCompletedPatients').textContent = completed;
            
            // Sort ascending by token number
            allTodayAppointments.sort((a, b) => (a.tokenNumber || 999) - (b.tokenNumber || 999));
            
            // Render Queue Table
            renderQueueTable(allTodayAppointments);
        }, err => {
            console.error('Appointments listener error:', err);
        });

    // Listener 2: Diagnostic reports for this doctor's patients
    db.collection('reports')
        .where('referredBy', '==', currentDoctorName)
        .onSnapshot(snapshot => {
            let pendingCount = 0;
            const reports = [];
            
            snapshot.forEach(doc => {
                const rep = { id: doc.id, ...doc.data() };
                const status = (rep.status || 'pending').toLowerCase();
                if (status === 'pending' || status === 'ready') {
                    reports.push(rep);
                    if (status === 'pending') pendingCount++;
                }
            });
            
            // Sort by creation date descending
            reports.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            
            document.getElementById('cardPendingReports').textContent = pendingCount;
            renderReportsTable(reports);
        }, err => {
            console.error('Reports listener error:', err);
        });

    // Listener 3: New patients registered by Reception (today's OPD queue)
    db.collection('patients')
        .where('status', '==', 'opd')
        .onSnapshot(snapshot => {
            const todayStr = todayIso();
            const todayPatients = [];
            snapshot.forEach(doc => {
                const p = { id: doc.id, ...doc.data() };
                const created = p.createdAt ? 
                    (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
                const isToday = created && isoDate(created) === todayStr;
                if (isToday && p.encounterId) {
                    todayPatients.push(p);
                }
            });
            
            // Sort by creation time descending
            todayPatients.sort((a, b) => {
                const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0) : 0;
                const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0) : 0;
                return tb - ta;
            });
            
            renderNewPatientQueue(todayPatients);
        }, err => {
            console.error('New patient queue error:', err);
        });
        
    // Listener 4: Prescriptions written by this doctor (pending fulfillment)
    db.collection('prescriptions')
        .where('doctorName', '==', currentDoctorName)
        .where('status', '==', 'pending')
        .onSnapshot(snapshot => {
            const rxList = [];
            snapshot.forEach(doc => {
                rxList.push({ id: doc.id, ...doc.data() });
            });
            
            // Sort descending
            rxList.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            
            document.getElementById('prescriptionCountBadge').textContent = `${rxList.length} pending`;
            renderPrescriptionsTable(rxList);
            
            // P7 NEW: Auto-add prescription items to reception's current bill
            autoAddPrescriptionsToCurrentBill(rxList);
        }, err => {
            console.error('Prescriptions listener error:', err);
        });
}

// ==========================================
// 2. WORKSPACE RENDERERS
// ==========================================

// Today's Appointments Queue Table
function renderQueueTable(appts) {
    const tbody = document.getElementById('doctorQueueBody');
    if (!tbody) return;
    
    if (appts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#888;"><i class="fa-solid fa-inbox" style="font-size:1.5rem; display:block; margin-bottom:6px;"></i>No appointments scheduled for today.</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    appts.forEach(appt => {
        const tr = document.createElement('tr');
        const status = (appt.status || 'scheduled').toLowerCase();
        
        let statusBadge = '';
        let actionBtn = '';
        
        if (status === 'completed') {
            statusBadge = '<span class="badge-status status-completed">Completed</span>';
            actionBtn = `<a href="consultations.html?patientId=${appt.patientId}" class="btn-view-consult"><i class="fa-solid fa-eye"></i> View Consult</a>`;
        } else if (status === 'in_progress') {
            statusBadge = '<span class="badge-status status-in_progress">In Progress</span>';
            actionBtn = `<button class="btn-start-consult" onclick="startConsultation('${appt.id}', '${appt.patientId}')"><i class="fa-solid fa-user-doctor"></i> Resume</button>`;
        } else {
            statusBadge = '<span class="badge-status status-scheduled">Waiting</span>';
            actionBtn = `<button class="btn-start-consult" onclick="startConsultation('${appt.id}', '${appt.patientId}')"><i class="fa-solid fa-stethoscope"></i> Consult</button>`;
        }
        
        // Calculate age
        let age = '—';
        if (appt.patientDocId) {
            // Age will be fetched or rendered. We can fallback to standard mock or pre-saved age
            age = appt.patientPhone ? '—' : '—'; // Default placeholder, will read from collection in standard way
        }
        
        tr.innerHTML = `
            <td><span class="badge-token">#${appt.tokenNumber || '—'}</span></td>
            <td><strong>${appt.patientName || '—'}</strong></td>
            <td><span class="id-badge">${appt.patientId || '—'}</span></td>
            <td>${appt.timeSlot || '—'}</td>
            <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${appt.chiefComplaint || ''}">${appt.chiefComplaint || '—'}</td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Patients' Pending & Ready Reports Table
function renderReportsTable(reps) {
    const tbody = document.getElementById('doctorReportsBody');
    if (!tbody) return;
    
    document.getElementById('reportsCountBadge').textContent = `${reps.length} active`;
    
    if (reps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">No active diagnostic reports.</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    reps.forEach(rep => {
        const tr = document.createElement('tr');
        const status = (rep.status || 'pending').toLowerCase();
        
        let statusBadge = '';
        let actionBtn = '<span style="color:#888;">—</span>';
        
        if (status === 'ready') {
            statusBadge = '<span style="background:#d1fae5; color:#065f46; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">Ready</span>';
            const url = rep.reportUrl || rep.uploadedReport;
            if (url) {
                actionBtn = `<a href="${url}" target="_blank" class="btn-view-pdf" style="font-size:11px; padding:3px 7px;"><i class="fa-solid fa-file-pdf"></i> View PDF</a>`;
            }
        } else {
            statusBadge = '<span style="background:#fee2e2; color:#991b1b; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">Pending</span>';
        }
        
        tr.innerHTML = `
            <td><strong>${rep.patientName || '—'}</strong></td>
            <td><span style="font-weight:500;">${rep.testName || '—'}</span></td>
            <td><span style="font-size:11px; background:#f1f5f9; padding:2px 6px; border-radius:8px; text-transform:uppercase;">${rep.type || 'lab'}</span></td>
            <td>${statusBadge}</td>
            <td>${formatDate(rep.createdAt || rep.reportDate)}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Written Prescriptions Table
function renderPrescriptionsTable(rxList) {
    const tbody = document.getElementById('doctorPrescriptionsBody');
    if (!tbody) return;
    
    if (rxList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">No pending prescriptions found.</td></tr>';
        return;
    }
    
    tbody.innerHTML = '';
    rxList.forEach(rx => {
        const tr = document.createElement('tr');
        const medCount = rx.medicines ? rx.medicines.length : 0;
        
        tr.innerHTML = `
            <td><strong>${rx.patientName || '—'}</strong></td>
            <td><span class="id-badge">${rx.prescriptionId || '—'}</span></td>
            <td><span style="font-weight:600; color:var(--primary-teal);">${medCount} medicines</span></td>
            <td>${formatDate(rx.createdAt)}</td>
            <td><span style="background:#fef3c7; color:#d97706; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600;"><i class="fa-solid fa-spinner fa-spin" style="margin-right:4px;"></i>Pending Pharmacy</span></td>
            <td>
                <button onclick="generateBilingualPrescriptionPDF('${rx.id || rx.prescriptionId}')" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; background: var(--primary-teal); border: none; border-radius: 4px; color: white; cursor: pointer;">
                    <i class="fa-solid fa-print"></i> Print Rx
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 3. START CONSULTATION ROUTE TRIGGER
// ==========================================
function startConsultation(apptId, patientId) {
    db.collection('appointments').doc(apptId).update({
        status: 'in_progress',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        window.location.href = `consultation.html?appointmentId=${apptId}&patientId=${patientId}`;
    }).catch(err => {
        console.error('Error starting consultation:', err);
        showToast('Error redirecting to consultation.', 'error');
    });
}
window.startConsultation = startConsultation;

// ==========================================
// 4. BOOK APPOINTMENT MODAL LOGIC (LOCKED TO THIS DOCTOR)
// ==========================================
const bookModal = document.getElementById('bookingModal');

document.getElementById('btnOpenBookModal').addEventListener('click', () => {
    selectedPatient = null;
    document.getElementById('bookingForm').reset();
    document.getElementById('bookingDoctorName').value = currentDoctorName;
    document.getElementById('bookingDoctorId').value = currentDoctorId;
    document.getElementById('bookingDept').value = currentDoctorDept;
    document.getElementById('bookingDate').value = todayIso();
    document.getElementById('selectedPatientCard').style.display = 'none';
    if (searchInput) searchInput.setAttribute('required', 'true');
    
    updateTokenPreview();
    bookModal.classList.add('active');
});

document.getElementById('closeBookingModalBtn').addEventListener('click', () => bookModal.classList.remove('active'));
document.getElementById('cancelBookingBtn').addEventListener('click', () => bookModal.classList.remove('active'));

document.getElementById('bookingDate').addEventListener('change', updateTokenPreview);

function updateTokenPreview() {
    const date = document.getElementById('bookingDate').value;
    const previewSpan = document.getElementById('tokenPreview');
    
    if (!date) {
        previewSpan.textContent = '# Select date first';
        return;
    }
    
    db.collection('appointments')
        .where('doctorId', '==', currentDoctorId)
        .where('appointmentDate', '==', date)
        .get()
        .then(snap => {
            const nextToken = snap.size + 1;
            previewSpan.textContent = `Token Assigned: #${nextToken}`;
        });
}

// Patient Autocomplete Suggestion search
const searchInput = document.getElementById('apptPatientSearch');
const searchResults = document.getElementById('apptPatientSearchResults');

searchInput.addEventListener('input', function(e) {
    const q = e.target.value.trim().toLowerCase();
    if (!q || q.length < 2) {
        searchResults.style.display = 'none';
        return;
    }
    
    searchResults.innerHTML = '<div style="padding:10px;color:#666;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    searchResults.style.display = 'block';
    
    let results = [];
    db.collection('patients').where('patientId', '==', q.toUpperCase()).get()
    .then(snap => {
        snap.forEach(doc => results.push({ docId: doc.id, ...doc.data() }));
        return db.collection('patients').orderBy('nameLower').startAt(q).endAt(q + '\uf8ff').limit(5).get();
    })
    .then(snap => {
        snap.forEach(doc => {
            if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
        });
        return db.collection('patients').where('phone', '==', q).get();
    })
    .then(snap => {
        snap.forEach(doc => {
            if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
        });
        
        renderSearchResults(results);
    }).catch(err => {
        searchResults.innerHTML = `<div style="padding:10px;color:red;font-size:12px;">Error: ${err.message}</div>`;
    });
});

function renderSearchResults(patients) {
    if (!patients.length) {
        searchResults.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">No patient found</div>';
        return;
    }
    
    let html = '';
    patients.forEach(p => {
        html += `
            <div class="search-result-item" onclick="selectPatientForBooking('${p.docId}', '${p.patientId}', '${p.name.replace(/'/g, "\\'")}', '${p.phone || ''}', '${p.age || ''}', '${p.gender || ''}')">
                <strong>${p.name}</strong> <span style="color:var(--primary-teal); font-size:11px; margin-left:4px;">${p.patientId}</span>
                <div style="font-size:11px; color:#888; margin-top:2px;">Phone: ${p.phone || '—'} | Gender: ${p.gender || '—'}</div>
            </div>
        `;
    });
    searchResults.innerHTML = html;
}

function selectPatientForBooking(docId, patientId, name, phone, age, gender) {
    selectedPatient = { docId, patientId, name, phone, age, gender };
    
    document.getElementById('cardPatientName').textContent = name;
    document.getElementById('cardPatientId').textContent = patientId;
    document.getElementById('cardAgeGender').textContent = `${age || '—'} / ${gender || '—'}`;
    document.getElementById('cardPhone').textContent = phone || '—';
    
    document.getElementById('selectedPatientCard').style.display = 'block';
    searchResults.style.display = 'none';
    searchInput.value = '';
    if (searchInput) searchInput.removeAttribute('required');
}
window.selectPatientForBooking = selectPatientForBooking;

document.getElementById('clearPatientBtn').addEventListener('click', () => {
    selectedPatient = null;
    document.getElementById('selectedPatientCard').style.display = 'none';
    if (searchInput) {
        searchInput.setAttribute('required', 'true');
        searchInput.focus();
    }
});

// Close suggestions dropdown on outside click
document.addEventListener('click', function(e) {
    if (searchInput && searchResults && !searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
    }
});

// Booking Submission
document.getElementById('bookingForm').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!selectedPatient) {
        showToast('Please select a patient first.', 'warning');
        return;
    }
    
    const saveBtn = document.getElementById('saveBookingBtn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    
    const date = document.getElementById('bookingDate').value;
    const time = document.getElementById('bookingTime').value;
    const visitType = document.getElementById('bookingVisitType').value;
    const complaint = document.getElementById('bookingComplaint').value.trim();
    
    db.collection('appointments')
        .where('doctorId', '==', currentDoctorId)
        .where('appointmentDate', '==', date)
        .get()
        .then(snap => {
            const tokenNumber = snap.size + 1;
            const apptId = 'APPT-' + Date.now();
            
            const appointmentData = {
                appointmentId: apptId,
                patientId: selectedPatient.patientId,
                patientDocId: selectedPatient.docId,
                patientName: selectedPatient.name,
                patientPhone: selectedPatient.phone || '',
                doctorId: currentDoctorId,
                doctorName: currentDoctorName,
                department: currentDoctorDept,
                appointmentDate: date,
                timeSlot: time,
                visitType: visitType,
                chiefComplaint: complaint || '',
                tokenNumber: tokenNumber,
                status: 'scheduled',
                bookedBy: currentUserEmail,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            
            return db.collection('appointments').doc(apptId).set(appointmentData).then(() => {
                // Update patient's last appointment field
                return db.collection('patients').doc(selectedPatient.docId).update({
                    lastAppointment: date,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }).then(() => {
                showToast(`Appointment booked successfully! Token: #${tokenNumber}`, 'success');
                bookModal.classList.remove('active');
                // Data loaders will update automatically via real-time snapshots
            });
        }).catch(err => {
            console.error('Save appointment error:', err);
            showToast('Failed to book appointment: ' + err.message, 'error');
        }).finally(() => {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Booking';
        });
});

// ==========================================
// 5. START CONSULTATION MODAL LOGIC (OUT-OF-QUEUE)
// ==========================================
let selectedConsultPatient = null;
const consultModal = document.getElementById('consultModal');

document.getElementById('btnOpenConsultModal').addEventListener('click', () => {
    selectedConsultPatient = null;
    document.getElementById('consultStartForm').reset();
    document.getElementById('selectedConsultPatientCard').style.display = 'none';
    document.getElementById('startConsultBtn').disabled = true;
    if (consultSearchInput) consultSearchInput.setAttribute('required', 'true');
    consultModal.classList.add('active');
});

document.getElementById('closeConsultModalBtn').addEventListener('click', () => consultModal.classList.remove('active'));
document.getElementById('cancelConsultBtn').addEventListener('click', () => consultModal.classList.remove('active'));

// Patient Autocomplete Suggestion search for Consultation Modal
const consultSearchInput = document.getElementById('consultPatientSearch');
const consultSearchResults = document.getElementById('consultPatientSearchResults');

consultSearchInput.addEventListener('input', function(e) {
    const q = e.target.value.trim().toLowerCase();
    if (!q || q.length < 2) {
        consultSearchResults.style.display = 'none';
        return;
    }
    
    consultSearchResults.innerHTML = '<div style="padding:10px;color:#666;font-size:13px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching...</div>';
    consultSearchResults.style.display = 'block';
    
    let results = [];
    db.collection('patients').where('patientId', '==', q.toUpperCase()).get()
    .then(snap => {
        snap.forEach(doc => results.push({ docId: doc.id, ...doc.data() }));
        return db.collection('patients').orderBy('nameLower').startAt(q).endAt(q + '\uf8ff').limit(5).get();
    })
    .then(snap => {
        snap.forEach(doc => {
            if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
        });
        return db.collection('patients').where('phone', '==', q).get();
    })
    .then(snap => {
        snap.forEach(doc => {
            if (!results.find(r => r.docId === doc.id)) results.push({ docId: doc.id, ...doc.data() });
        });
        
        renderConsultSearchResults(results);
    }).catch(err => {
        consultSearchResults.innerHTML = `<div style="padding:10px;color:red;font-size:12px;">Error: ${err.message}</div>`;
    });
});

function renderConsultSearchResults(patients) {
    if (!patients.length) {
        consultSearchResults.innerHTML = '<div style="padding:10px;color:#888;font-size:13px;">No patient found</div>';
        return;
    }
    
    let html = '';
    patients.forEach(p => {
        html += `
            <div class="search-result-item" onclick="selectPatientForConsult('${p.docId}', '${p.patientId}', '${p.name.replace(/'/g, "\\'")}', '${p.phone || ''}', '${p.age || ''}', '${p.gender || ''}')">
                <strong>${p.name}</strong> <span style="color:var(--primary-teal); font-size:11px; margin-left:4px;">${p.patientId}</span>
                <div style="font-size:11px; color:#888; margin-top:2px;">Phone: ${p.phone || '—'} | Gender: ${p.gender || '—'}</div>
            </div>
        `;
    });
    consultSearchResults.innerHTML = html;
}

function selectPatientForConsult(docId, patientId, name, phone, age, gender) {
    selectedConsultPatient = { docId, patientId, name, phone, age, gender };
    
    document.getElementById('consultCardPatientName').textContent = name;
    document.getElementById('consultCardPatientId').textContent = patientId;
    document.getElementById('consultCardAgeGender').textContent = `${age || '—'} / ${gender || '—'}`;
    document.getElementById('consultCardPhone').textContent = phone || '—';
    
    document.getElementById('selectedConsultPatientCard').style.display = 'block';
    consultSearchResults.style.display = 'none';
    consultSearchInput.value = '';
    if (consultSearchInput) consultSearchInput.removeAttribute('required');
    document.getElementById('startConsultBtn').disabled = false;
}
window.selectPatientForConsult = selectPatientForConsult;

document.getElementById('clearConsultPatientBtn').addEventListener('click', () => {
    selectedConsultPatient = null;
    document.getElementById('selectedConsultPatientCard').style.display = 'none';
    document.getElementById('startConsultBtn').disabled = true;
    if (consultSearchInput) {
        consultSearchInput.setAttribute('required', 'true');
        consultSearchInput.focus();
    }
});

// Close suggestions dropdown on outside click
document.addEventListener('click', function(e) {
    if (consultSearchInput && consultSearchResults && !consultSearchInput.contains(e.target) && !consultSearchResults.contains(e.target)) {
        consultSearchResults.style.display = 'none';
    }
});

// Consultation Start Form Submission
document.getElementById('consultStartForm').addEventListener('submit', function(e) {
    e.preventDefault();
    if (!selectedConsultPatient) {
        showToast('Please select a patient first.', 'warning');
        return;
    }
    
    const patientId = selectedConsultPatient.patientId;
    consultModal.classList.remove('active');
    window.location.href = `consultation.html?patientId=${patientId}`;
});

// New Patient Queue from Reception
function renderNewPatientQueue(patients) {
    const tbody = document.getElementById('newPatientQueueBody');
    if (!tbody) return;
    const todayStr = todayIso();
    const todayPatients = [];
    patients.forEach(p => {
        const created = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
        const isToday = created && isoDate(created) === todayStr;
        if (isToday && p.encounterId) {
            todayPatients.push(p);
        }
    });
    
    if (todayPatients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#888;">No new patients from Reception.</td></tr>';
        return;
    }
    
    todayPatients.sort((a, b) => {
        const ta = a.createdAt ? (a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0) : 0;
        const tb = b.createdAt ? (b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0) : 0;
        return tb - ta;
    });
    
    tbody.innerHTML = '';
    todayPatients.forEach(p => {
        const created = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
        const age = created ? Math.floor((new Date() - created) / (365.25 * 24 * 60 * 60 * 1000)) : '—';
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><span class="badge-token">#' + (p.encounterId || '—') + '</span></td>'
            + '<td><strong>' + (p.name || '—') + '</strong></td>'
            + '<td><span class="id-badge">' + (p.patientId || '—') + '</span></td>'
            + '<td>' + age + ' Yrs</td>'
            + '<td>' + (p.department || '—') + '</td>'
            + '<td><button class="btn-primary btn-xs" onclick="startConsultationFromQueue(`' + p.id + '`)">Consult</button></td>';
        tbody.appendChild(tr);
    });
}

function startConsultationFromQueue(patientDocId) {
    db.collection('patients').doc(patientDocId).get().then(doc => {
        if (!doc.exists) {
            showToast('Patient not found.', 'error');
            return;
        }
        const patient = { id: doc.id, ...doc.data() };
        window.location.href = 'consultation.html?patientId=' + patient.patientId;
    }).catch(err => {
        console.error('Error fetching patient:', err);
        showToast('Error loading patient.', 'error');
    });
}

// P7 NEW: Auto-add prescription items to reception's current open bill
function autoAddPrescriptionsToCurrentBill(rxList) {
    if (!rxList || !rxList.length) return;
    var db = typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null;
    if (!db) return;
    var currentUserEmail = '';
    if (typeof getCurrentUser === 'function') {
        getCurrentUser((user) => {
            currentUserEmail = user ? (user.email || '') : '';
        });
    }
    
    // Query bills that are unpaid/partial and from today
    var todayStr = todayIso();
    db.collection('bills')
        .where('paymentStatus', 'in', ['unpaid', 'partial'])
        .where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(new Date(todayStr + 'T00:00:00Z')))
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
        .then(snapshot => {
            if (snapshot.empty) {
                // No current open bill - nothing to auto-add to
                return;
            }
            
            var billDoc = snapshot.docs[0];
            var billData = billDoc.data();
            var billId = billData.billId || billDoc.id;
            
            // Build a map of medicine names and quantities for this patient
            var rxItemsMap = {};
            rxList.forEach(function(rx) {
                if (rx.patientId && billData.patientId && rx.patientId !== billData.patientId) return;
                if (rx.medicines && rx.medicines.length > 0) {
                    rx.medicines.forEach(function(med) {
                        var name = med.name || med.medicineName || '';
                        if (!name) return;
                        if (!rxItemsMap[name]) rxItemsMap[name] = { quantity: 0, unitPrice: med.unitPrice || 0, description: med.description || '' };
                        rxItemsMap[name].quantity += (med.quantity || 1);
                    });
                }
                // Also check for direct medicine fields
                if (rx.medicine) {
                    var name = rx.medicine.name || '';
                    if (name) {
                        if (!rxItemsMap[name]) rxItemsMap[name] = { quantity: 0, unitPrice: rx.medicine.unitPrice || 0, description: rx.medicine.description || '' };
                        rxItemsMap[name].quantity += (rx.medicine.quantity || 1);
                    }
                }
            });
            
            if (Object.keys(rxItemsMap).length === 0) return;
            
            // Check if items already exist in the bill
            var existingItems = billData.items || [];
            var existingDescs = new Set();
            existingItems.forEach(function(item) {
                if (item.description) existingDescs.add(item.description.toLowerCase());
            });
            
            // Add new items that aren't already in the bill
            var newItems = [];
            var now = new Date();
            Object.entries(rxItemsMap).forEach(function(_ref) {
                var _name = _ref[0], _data = _ref[1];
                var lowerDesc = _data.description.toLowerCase();
                if (!existingDescs.has(lowerDesc)) {
                    newItems.push({
                        category: 'Medicine',
                        description: _data.description,
                        quantity: _data.quantity,
                        unitPrice: _data.unitPrice,
                        amount: _data.unitPrice * _data.quantity,
                        orderedBy: currentDoctorName
                    });
                }
            });
            
            if (newItems.length > 0) {
                // Recalculate totals
                var subtotal = existingItems.reduce(function(sum, item) { return sum + item.amount; }, 0) + newItems.reduce(function(sum, item) { return sum + item.amount; }, 0);
                var discountAmt = subtotal * ((billData.discountPercent || 0) / 100);
                var afterDiscount = subtotal - discountAmt;
                var gstAmt = afterDiscount * ((billData.gstPercent || 0) / 100);
                var grandTotal = afterDiscount + gstAmt;
                var balanceDue = grandTotal - (billData.amountPaid || 0);
                
                var newStatus = 'due';
                if (balanceDue <= 0) newStatus = 'paid';
                else if (balanceDue < grandTotal) newStatus = 'partial';
                
                // Update the bill document
                db.collection('bills').doc(billDoc.id).update({
                    items: [...existingItems, ...newItems],
                    subtotal: subtotal,
                    discountAmount: discountAmt,
                    gstAmount: gstAmt,
                    grandTotal: grandTotal,
                    balanceDue: balanceDue,
                    status: newStatus,
                    paymentStatus: newStatus,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }).then(function() {
                    // Also update the patient subcollection bill
                    var patientDocId = billData.patientDocId;
                    if (patientDocId) {
                        db.collection('patients').doc(patientDocId).collection('bills').doc(billId).update({
                            items: [...existingItems, ...newItems],
                            subtotal: subtotal,
                            discountAmount: discountAmt,
                            gstAmount: gstAmt,
                            grandTotal: grandTotal,
                            balanceDue: balanceDue,
                            status: newStatus,
                            paymentStatus: newStatus,
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        }).then(function() {
                            showToast('Prescription items auto-added to current bill.', 'success');
                        }).catch(function(err) {
                            console.error('Error updating patient subcollection bill:', err);
                        });
                    }
                    showToast('Prescription items auto-added to current bill.', 'success');
                }).catch(function(err) {
                    console.error('Error updating bill:', err);
                    showToast('Failed to auto-add prescription items: ' + err.message, 'error');
                });
            }
        })
        .catch(function(err) {
            console.error('Error finding current bill:', err);
        });
}
