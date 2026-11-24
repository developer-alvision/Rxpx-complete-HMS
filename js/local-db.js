/**
 * RxPx Hospitals - Local Standalone Database & Auth Engine
 * Replaces Firebase completely with zero external cloud dependencies.
 * Stores data locally in localStorage / IndexedDB with real-time multi-tab synchronization.
 */
(function (global) {
    'use strict';

    // In-memory collection storage
    var _memoryStore = {};
    var _listeners = [];
    var _channel = null;

    if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') {
        try {
            _channel = new BroadcastChannel('rxpx_db_channel');
            _channel.onmessage = function (event) {
                if (event && event.data && event.data.collection) {
                    _notifyLocalListeners(event.data.collection, false);
                }
            };
        } catch (e) {
            console.warn('BroadcastChannel not available:', e);
        }
    }

    function _hasLocalStorage() {
        try {
            return typeof window !== 'undefined' && window.localStorage !== null;
        } catch (e) {
            return false;
        }
    }

    function _getStorageKey(collectionName) {
        return 'rxpx_col_' + collectionName.replace(/\//g, '_');
    }

    function _loadCollection(collectionName) {
        if (_memoryStore[collectionName]) {
            return _memoryStore[collectionName];
        }
        if (_hasLocalStorage()) {
            var raw = localStorage.getItem(_getStorageKey(collectionName));
            if (!raw) {
                // Fallback check legacy key
                raw = localStorage.getItem('jmh_col_' + collectionName.replace(/\//g, '_'));
            }
            if (raw) {
                try {
                    var parsed = JSON.parse(raw);
                    _memoryStore[collectionName] = parsed;
                    return parsed;
                } catch (e) {
                    console.error('Error parsing collection ' + collectionName, e);
                }
            }
        }
        _memoryStore[collectionName] = {};
        return _memoryStore[collectionName];
    }

    function _saveCollection(collectionName) {
        if (!_hasLocalStorage()) return;
        try {
            var data = _memoryStore[collectionName] || {};
            localStorage.setItem(_getStorageKey(collectionName), JSON.stringify(data));
        } catch (e) {
            console.error('Error saving collection ' + collectionName, e);
        }
    }

    function _notifyLocalListeners(collectionName, broadcast) {
        if (broadcast && _channel) {
            try {
                _channel.postMessage({ collection: collectionName, time: Date.now() });
            } catch (err) {}
        }
        // Force refresh in-memory store from localStorage if incoming from another tab
        if (!broadcast && _hasLocalStorage()) {
            var raw = localStorage.getItem(_getStorageKey(collectionName));
            if (raw) {
                try { _memoryStore[collectionName] = JSON.parse(raw); } catch (e) {}
            }
        }
        _listeners.forEach(function (sub) {
            if (sub.collectionName === collectionName && typeof sub.callback === 'function') {
                try {
                    var snap;
                    if (sub.docId) {
                        // Document listener: emit the current state of that one document
                        var docCol = _loadCollection(collectionName);
                        snap = new DocumentSnapshot(sub.docId, docCol[sub.docId], new DocumentReference(collectionName, sub.docId));
                    } else {
                        snap = sub.query._execute();
                    }
                    sub.callback(snap);
                } catch (e) {
                    console.error('Error in onSnapshot listener:', e);
                }
            }
        });
    }

    function _clone(val) {
        if (val === undefined || val === null) return val;
        if (typeof val === 'object') {
            if (val._isTimestamp) {
                return {
                    _isTimestamp: true,
                    seconds: val.seconds,
                    nanoseconds: val.nanoseconds || 0,
                    toDate: function () { return new Date(this.seconds * 1000); }
                };
            }
            if (val instanceof Date) {
                var sec = Math.floor(val.getTime() / 1000);
                return {
                    _isTimestamp: true,
                    seconds: sec,
                    nanoseconds: 0,
                    toDate: function () { return new Date(sec * 1000); }
                };
            }
            if (Array.isArray(val)) {
                return val.map(_clone);
            }
            var copy = {};
            Object.keys(val).forEach(function (k) {
                copy[k] = _clone(val[k]);
            });
            return copy;
        }
        return val;
    }

    function _resolveFieldValues(data, existing) {
        var result = Object.assign({}, existing || {});
        Object.keys(data || {}).forEach(function (key) {
            var val = data[key];
            if (val && val._isFieldValueServerTimestamp) {
                var sec = Math.floor(Date.now() / 1000);
                result[key] = {
                    _isTimestamp: true,
                    seconds: sec,
                    nanoseconds: 0,
                    toDate: function () { return new Date(sec * 1000); }
                };
            } else if (val && val._isFieldValueIncrement) {
                result[key] = Number(result[key] || 0) + Number(val.amount || 0);
            } else if (val && val._isFieldValueArrayUnion) {
                var arr = Array.isArray(result[key]) ? result[key].slice() : [];
                (val.elements || []).forEach(function (el) {
                    if (arr.indexOf(el) === -1) arr.push(el);
                });
                result[key] = arr;
            } else if (val && val._isFieldValueArrayRemove) {
                var currentArr = Array.isArray(result[key]) ? result[key].slice() : [];
                (val.elements || []).forEach(function (el) {
                    var idx = currentArr.indexOf(el);
                    if (idx !== -1) currentArr.splice(idx, 1);
                });
                result[key] = currentArr;
            } else {
                result[key] = _clone(val);
            }
        });
        return result;
    }

    // --- DocumentSnapshot & QuerySnapshot ---
    function DocumentSnapshot(id, data, ref) {
        this.id = id;
        this._data = data ? _clone(data) : null;
        this.exists = !!data;
        this.ref = ref;
    }
    DocumentSnapshot.prototype.data = function () {
        if (!this._data) return undefined;
        var out = _clone(this._data);
        // Hydrate toDate on timestamps
        Object.keys(out).forEach(function (k) {
            if (out[k] && out[k]._isTimestamp) {
                out[k].toDate = function () { return new Date(this.seconds * 1000); };
            }
        });
        return out;
    };

    function QuerySnapshot(docs) {
        this.docs = docs;
        this.empty = docs.length === 0;
        this.size = docs.length;
    }
    QuerySnapshot.prototype.forEach = function (callback) {
        this.docs.forEach(callback);
    };

    // --- DocumentReference ---
    function DocumentReference(collectionName, docId) {
        this.id = docId;
        this.path = collectionName + '/' + docId;
        this.collectionName = collectionName;
    }
    DocumentReference.prototype.collection = function (subName) {
        return new CollectionReference(this.collectionName + '_' + this.id + '_' + subName);
    };
    DocumentReference.prototype.get = function () {
        var col = _loadCollection(this.collectionName);
        var data = col[this.id];
        return Promise.resolve(new DocumentSnapshot(this.id, data, this));
    };
    DocumentReference.prototype.set = function (data, options) {
        var col = _loadCollection(this.collectionName);
        var merge = options && options.merge;
        var existing = merge ? col[this.id] : {};
        var updated = _resolveFieldValues(data, existing);
        col[this.id] = updated;
        _saveCollection(this.collectionName);
        _notifyLocalListeners(this.collectionName, true);
        return Promise.resolve();
    };
    DocumentReference.prototype.update = function (data) {
        var col = _loadCollection(this.collectionName);
        var existing = col[this.id];
        if (!existing) {
            existing = {};
        }
        var updated = _resolveFieldValues(data, existing);
        col[this.id] = updated;
        _saveCollection(this.collectionName);
        _notifyLocalListeners(this.collectionName, true);
        return Promise.resolve();
    };
    DocumentReference.prototype.delete = function () {
        var col = _loadCollection(this.collectionName);
        delete col[this.id];
        _saveCollection(this.collectionName);
        _notifyLocalListeners(this.collectionName, true);
        return Promise.resolve();
    };

    // Real-time document listener. Mirrors the collection-level onSnapshot
    // above: fires immediately with the current document and again every
    // time the collection changes. watchSession() in helpers.js depends on
    // this — without it every page bounced back to the login screen.
    DocumentReference.prototype.onSnapshot = function (onNext, onError) {
        var self = this;
        var sub = { collectionName: this.collectionName, docId: this.id, callback: onNext };
        _listeners.push(sub);
        setTimeout(function () {
            try {
                onNext(new DocumentSnapshot(self.id, _loadCollection(self.collectionName)[self.id], self));
            } catch (err) {
                if (typeof onError === 'function') onError(err);
            }
        }, 0);
        return function unsubscribe() {
            var idx = _listeners.indexOf(sub);
            if (idx !== -1) _listeners.splice(idx, 1);
        };
    };

    // --- Query & CollectionReference ---
    function Query(collectionName, filters, sorts, limitNum) {
        this.collectionName = collectionName;
        this.filters = filters || [];
        this.sorts = sorts || [];
        this.limitNum = limitNum || null;
    }

    Query.prototype.where = function (field, op, val) {
        var newFilters = this.filters.concat([{ field: field, op: op, val: val }]);
        return new Query(this.collectionName, newFilters, this.sorts, this.limitNum);
    };

    Query.prototype.orderBy = function (field, dir) {
        var newSorts = this.sorts.concat([{ field: field, dir: dir || 'asc' }]);
        return new Query(this.collectionName, this.filters, newSorts, this.limitNum);
    };

    Query.prototype.limit = function (n) {
        return new Query(this.collectionName, this.filters, this.sorts, n);
    };

    function _extractVal(obj, path) {
        if (!obj || !path) return undefined;
        if (obj[path] !== undefined) return obj[path];
        var parts = path.split('.');
        var curr = obj;
        for (var i = 0; i < parts.length; i++) {
            if (curr == null) return undefined;
            curr = curr[parts[i]];
        }
        return curr;
    }

    function _compareValues(a, b) {
        if (a === b) return 0;
        if (a == null && b != null) return -1;
        if (a != null && b == null) return 1;
        var valA = (a && a._isTimestamp) ? a.seconds : (a && a.getTime ? Math.floor(a.getTime() / 1000) : a);
        var valB = (b && b._isTimestamp) ? b.seconds : (b && b.getTime ? Math.floor(b.getTime() / 1000) : b);
        if (valA < valB) return -1;
        if (valA > valB) return 1;
        return 0;
    }

    Query.prototype._execute = function () {
        var col = _loadCollection(this.collectionName);
        var self = this;
        var docs = [];

        Object.keys(col).forEach(function (docId) {
            var item = col[docId];
            var matches = true;

            for (var i = 0; i < self.filters.length; i++) {
                var f = self.filters[i];
                var v = _extractVal(item, f.field);
                var target = f.val;

                if (target && target._isTimestamp) target = target.seconds;
                var cmpV = (v && v._isTimestamp) ? v.seconds : v;

                if (f.op === '==') {
                    if (cmpV !== target) { matches = false; break; }
                } else if (f.op === '!=') {
                    if (cmpV === target) { matches = false; break; }
                } else if (f.op === 'in') {
                    if (!Array.isArray(target) || target.indexOf(cmpV) === -1) { matches = false; break; }
                } else if (f.op === 'array-contains') {
                    if (!Array.isArray(v) || v.indexOf(target) === -1) { matches = false; break; }
                } else if (f.op === '>') {
                    if (_compareValues(cmpV, target) <= 0) { matches = false; break; }
                } else if (f.op === '>=') {
                    if (_compareValues(cmpV, target) < 0) { matches = false; break; }
                } else if (f.op === '<') {
                    if (_compareValues(cmpV, target) >= 0) { matches = false; break; }
                } else if (f.op === '<=') {
                    if (_compareValues(cmpV, target) > 0) { matches = false; break; }
                }
            }

            if (matches) {
                docs.push(new DocumentSnapshot(docId, item, new DocumentReference(self.collectionName, docId)));
            }
        });

        // Apply sorts
        if (this.sorts.length > 0) {
            docs.sort(function (a, b) {
                var dataA = a.data() || {};
                var dataB = b.data() || {};
                for (var i = 0; i < self.sorts.length; i++) {
                    var s = self.sorts[i];
                    var valA = _extractVal(dataA, s.field);
                    var valB = _extractVal(dataB, s.field);
                    var cmp = _compareValues(valA, valB);
                    if (cmp !== 0) {
                        return s.dir === 'desc' ? -cmp : cmp;
                    }
                }
                return 0;
            });
        }

        // Apply limit
        if (this.limitNum != null && this.limitNum >= 0) {
            docs = docs.slice(0, this.limitNum);
        }

        return new QuerySnapshot(docs);
    };

    Query.prototype.get = function () {
        var snap = this._execute();
        return Promise.resolve(snap);
    };

    Query.prototype.onSnapshot = function (onNext, onError) {
        var self = this;
        var sub = {
            collectionName: this.collectionName,
            query: this,
            callback: onNext
        };
        _listeners.push(sub);

        // Immediately trigger initial results asynchronously
        setTimeout(function () {
            try {
                var initialSnap = self._execute();
                onNext(initialSnap);
            } catch (err) {
                if (onError) onError(err);
            }
        }, 0);

        return function unsubscribe() {
            var idx = _listeners.indexOf(sub);
            if (idx !== -1) _listeners.splice(idx, 1);
        };
    };

    function CollectionReference(name) {
        Query.call(this, name);
    }
    CollectionReference.prototype = Object.create(Query.prototype);
    CollectionReference.prototype.constructor = CollectionReference;

    CollectionReference.prototype.doc = function (docId) {
        var id = docId || ('auto_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6));
        return new DocumentReference(this.collectionName, id);
    };

    CollectionReference.prototype.add = function (data) {
        var ref = this.doc();
        return ref.set(data).then(function () {
            return ref;
        });
    };

    // --- Transaction & Batch ---
    function Transaction() {
        this._writes = [];
    }
    Transaction.prototype.get = function (ref) {
        return ref.get();
    };
    Transaction.prototype.set = function (ref, data, options) {
        this._writes.push({ type: 'set', ref: ref, data: data, options: options });
    };
    Transaction.prototype.update = function (ref, data) {
        this._writes.push({ type: 'update', ref: ref, data: data });
    };
    Transaction.prototype.delete = function (ref) {
        this._writes.push({ type: 'delete', ref: ref });
    };

    function WriteBatch() {
        this._writes = [];
    }
    WriteBatch.prototype.set = function (ref, data, options) {
        this._writes.push({ type: 'set', ref: ref, data: data, options: options });
    };
    WriteBatch.prototype.update = function (ref, data) {
        this._writes.push({ type: 'update', ref: ref, data: data });
    };
    WriteBatch.prototype.delete = function (ref) {
        this._writes.push({ type: 'delete', ref: ref });
    };
    WriteBatch.prototype.commit = function () {
        var touchedCollections = new Set();
        this._writes.forEach(function (w) {
            var col = _loadCollection(w.ref.collectionName);
            touchedCollections.add(w.ref.collectionName);
            if (w.type === 'set') {
                var existing = (w.options && w.options.merge) ? col[w.ref.id] : {};
                col[w.ref.id] = _resolveFieldValues(w.data, existing);
            } else if (w.type === 'update') {
                var cur = col[w.ref.id] || {};
                col[w.ref.id] = _resolveFieldValues(w.data, cur);
            } else if (w.type === 'delete') {
                delete col[w.ref.id];
            }
        });
        touchedCollections.forEach(function (c) {
            _saveCollection(c);
            _notifyLocalListeners(c, true);
        });
        return Promise.resolve();
    };

    // --- Firestore instance ---
    function FirestoreInstance() {}
    FirestoreInstance.prototype.collection = function (name) {
        return new CollectionReference(name);
    };
    FirestoreInstance.prototype.enablePersistence = function () {
        return Promise.resolve();
    };
    FirestoreInstance.prototype.useEmulator = function () {};
    FirestoreInstance.prototype.batch = function () {
        return new WriteBatch();
    };
    FirestoreInstance.prototype.runTransaction = function (fn) {
        var tx = new Transaction();
        return Promise.resolve()
            .then(function () { return fn(tx); })
            .then(function (result) {
                var touchedCollections = new Set();
                tx._writes.forEach(function (w) {
                    var col = _loadCollection(w.ref.collectionName);
                    touchedCollections.add(w.ref.collectionName);
                    if (w.type === 'set') {
                        var existing = (w.options && w.options.merge) ? col[w.ref.id] : {};
                        col[w.ref.id] = _resolveFieldValues(w.data, existing);
                    } else if (w.type === 'update') {
                        var cur = col[w.ref.id] || {};
                        col[w.ref.id] = _resolveFieldValues(w.data, cur);
                    } else if (w.type === 'delete') {
                        delete col[w.ref.id];
                    }
                });
                touchedCollections.forEach(function (c) {
                    _saveCollection(c);
                    _notifyLocalListeners(c, true);
                });
                return result;
            });
    };

    // --- Auth instance ---
    var _authCallbacks = [];
    var _currentUser = null;

    var SEED_STAFF = {
        'admin': {
            uid: 'admin', id: 'admin', docId: 'admin',
            name: 'RxPx Administrator', email: 'admin@rxpx.in', password: 'Rxpx@12345',
            role: 'admin', department: 'Administration', isActive: true, phone: '9949979578'
        },
        'reception': {
            uid: 'reception', id: 'reception', docId: 'reception',
            name: 'Reception Desk', email: 'reception@rxpx.in', password: 'Rxpx@12345',
            role: 'receptionist', department: 'Reception', isActive: true, phone: '9949979578'
        },
        'pooja': {
            uid: 'pooja', id: 'pooja', docId: 'pooja',
            name: 'Dr. G. Pooja', email: 'pooja@rxpx.in', password: 'Pooja@12345',
            role: 'doctor', isAdmin: true,
            specialisation: 'Obstetrician and Gynaecologist (MBBS, MS OBG)',
            services: ['Normal Delivery', 'C-Section', 'Antenatal Care', 'PCOD / PCOS Management', 'Fibroids Management', 'Family Planning', 'Infertility Evaluation & Treatment', 'Cancer Screening', 'Menstrual Cycle Issues', 'Menopause Care', 'Vaccinations', "General Women's Health Care"],
            department: 'Obstetrics & Gynaecology', opFee: 300, freeOP: false,
            isActive: true, phone: '9949979578'
        },
        'ramakanth': {
            uid: 'ramakanth', id: 'ramakanth', docId: 'ramakanth',
            name: 'Dr. Ramakanth Reddy', email: 'ramakanth@rxpx.in', password: 'Ramakanth@12345',
            role: 'doctor', isAdmin: true,
            specialisation: 'Family Physician & Diabetologist (Director)',
            services: ['Diabetes Screening & Diagnosis', 'Personalized Diet & Lifestyle Guidance', 'Diabetes Management Programs', 'General Medicine Care', 'Patient Education & Support', 'Regular Sugar Monitoring', 'Personalized Treatment & Insulin Care', 'Heart Health & Complication Prevention'],
            department: 'Family Medicine & Diabetology', opFee: 300, freeOP: false,
            isActive: true, phone: '9949979578'
        },
        'lab': {
            uid: 'lab', id: 'lab', docId: 'lab',
            name: 'Laboratory Desk', email: 'lab@rxpx.in', password: 'Lab@12345',
            role: 'lab_technician', department: 'Laboratory',
            isActive: true, phone: '9949979578'
        },
        'pharmacy': {
            uid: 'pharmacy', id: 'pharmacy', docId: 'pharmacy',
            name: 'Pharmacy Desk', email: 'pharmacy@rxpx.in', password: 'Pharmacy@12345',
            role: 'pharmacist', department: 'Pharmacy',
            isActive: true, phone: '9949979578'
        }
    };

    function AuthInstance() {
        if (_hasLocalStorage()) {
            var saved = localStorage.getItem('rxpx_active_user') || localStorage.getItem('jmh_active_user');
            if (saved) {
                try {
                    _currentUser = JSON.parse(saved);
                } catch (e) {}
            }
        }
        if (!_currentUser) {
            // Default to Reception on first launch
            _currentUser = SEED_STAFF['reception'];
        }
        this.currentUser = _currentUser;
    }

    AuthInstance.prototype.onAuthStateChanged = function (callback) {
        if (typeof callback !== 'function') return function () {};
        _authCallbacks.push(callback);
        var u = this.currentUser;
        setTimeout(function () {
            callback(u);
        }, 0);
        return function () {
            var i = _authCallbacks.indexOf(callback);
            if (i !== -1) _authCallbacks.splice(i, 1);
        };
    };

    AuthInstance.prototype.signInWithEmailAndPassword = function (email, password) {
        var lower = (email || '').toLowerCase().trim();
        var prefix = lower.split('@')[0];
        var matched = null;
        Object.keys(SEED_STAFF).forEach(function (k) {
            var s = SEED_STAFF[k];
            if (s.email.toLowerCase() === lower || s.uid.toLowerCase() === lower || s.uid.toLowerCase() === prefix || s.name.toLowerCase() === lower) {
                matched = s;
            }
        });
        if (!matched) {
            // Check in db staff collection
            var col = _loadCollection('staff');
            Object.keys(col).forEach(function (k) {
                var s = col[k];
                if (s && s.email && (s.email.toLowerCase() === lower || (s.email.toLowerCase().split('@')[0] === prefix))) {
                    matched = Object.assign({ uid: k, id: k, docId: k }, s);
                }
            });
        }
        if (!matched) {
            var err = new Error('No account found with this email address.');
            err.code = 'auth/user-not-found';
            return Promise.reject(err);
        }
        // Validate password if the matched staff has one set
        if (matched.password && password !== matched.password) {
            var pwdErr = new Error('Incorrect email or password.');
            pwdErr.code = 'auth/invalid-credential';
            return Promise.reject(pwdErr);
        }
        _currentUser = Object.assign({}, matched);
        delete _currentUser.password;
        this.currentUser = _currentUser;
        if (_hasLocalStorage()) {
            localStorage.setItem('rxpx_active_user', JSON.stringify(_currentUser));
        }
        _authCallbacks.forEach(function (cb) { try { cb(_currentUser); } catch (e) {} });
        return Promise.resolve({ user: _currentUser });
    };

    AuthInstance.prototype.signInRole = function (roleKey) {
        var matched = SEED_STAFF[roleKey];
        if (!matched) return Promise.reject(new Error('Unknown role: ' + roleKey));
        return this.signInWithEmailAndPassword(matched.email, matched.password);
    };

    AuthInstance.prototype.signOut = function () {
        _currentUser = null;
        this.currentUser = null;
        if (_hasLocalStorage()) {
            localStorage.removeItem('rxpx_active_user');
            localStorage.removeItem('jmh_active_user');
        }
        _authCallbacks.forEach(function (cb) { try { cb(null); } catch (e) {} });
        return Promise.resolve();
    };

    AuthInstance.prototype.useEmulator = function () {};

    // --- Pre-seed essential Hospital data ---
    var RXPX_PROFILE = {
        hospitalName: 'RxPx Hospitals',
        name: 'RxPx Hospitals',
        phone: '+91 99499 79578',
        address: 'Near Old Bus Stand, Ambakpalli Road, Pulivendula, YSR Kadapa, Andhra Pradesh',
        email: 'contact@rxpxhospitals.com',
        tagline: 'Healing Happens Here'
    };

    function _seedInitialHospitalData() {
        // 1. Staff — seed missing accounts and refresh seed-account details
        // (name / role / department / specialisation) so previously seeded
        // browsers pick up corrections without losing passwords or sessions.
        var staffCol = _loadCollection('staff');
        Object.keys(SEED_STAFF).forEach(function (k) {
            var seed = SEED_STAFF[k];
            var existing = staffCol[k];
            if (!existing) {
                staffCol[k] = Object.assign({}, seed);
            } else {
                // Refresh identity fields but preserve any locally chosen password
                var keepPassword = existing.password || seed.password;
                Object.keys(seed).forEach(function (field) {
                    existing[field] = seed[field];
                });
                existing.password = keepPassword;
            }
        });
        _saveCollection('staff');

        // 2. Hospital Profile & Settings — update branding fields in place so
        // integrations / GSTIN / other settings configured by staff survive.
        var pub = _loadCollection('publicHospital');
        if (!pub['main'] || pub['main'].hospitalName !== RXPX_PROFILE.hospitalName || pub['main'].address !== RXPX_PROFILE.address) {
            pub['main'] = Object.assign({}, pub['main'] || {}, RXPX_PROFILE);
            _saveCollection('publicHospital');
        }

        var sett = _loadCollection('hospitalSettings');
        if (!sett['main'] || sett['main'].hospitalName !== RXPX_PROFILE.hospitalName || sett['main'].address !== RXPX_PROFILE.address) {
            sett['main'] = Object.assign({ gstin: '' }, sett['main'] || {}, RXPX_PROFILE);
            _saveCollection('hospitalSettings');
        }

        // 3. Bill & Patient Counters
        var counters = _loadCollection('billCounters');
        if (!counters['opd']) counters['opd'] = { count: 100 };
        if (!counters['pharmacy']) counters['pharmacy'] = { count: 100 };
        _saveCollection('billCounters');

        var pCount = _loadCollection('patientCounter');
        if (!pCount['main']) {
            pCount['main'] = { count: 100 };
            _saveCollection('patientCounter');
        }

        // 4. Pre-seed Pharmacy Medicines if empty
        var pharma = _loadCollection('pharmacy');
        if (Object.keys(pharma).length === 0) {
            var defaultMeds = [
                { medicineName: 'Paracetamol 500mg', genericName: 'Paracetamol', dosage: '500mg', unitPrice: 2.50, stock: 500, batchNumber: 'BAT-2026-01', expiryDate: '2028-12-31', schedule: 'H', gstRate: 12 },
                { medicineName: 'Amoxicillin 500mg', genericName: 'Amoxicillin', dosage: '500mg', unitPrice: 8.00, stock: 350, batchNumber: 'BAT-2026-02', expiryDate: '2028-10-31', schedule: 'H', gstRate: 12 },
                { medicineName: 'Folic Acid 5mg', genericName: 'Folic Acid', dosage: '5mg', unitPrice: 1.50, stock: 800, batchNumber: 'BAT-2026-03', expiryDate: '2029-05-31', schedule: 'G', gstRate: 5 },
                { medicineName: 'Calcium + Vit D3', genericName: 'Calcium Carbonate', dosage: '500mg', unitPrice: 5.00, stock: 600, batchNumber: 'BAT-2026-04', expiryDate: '2028-08-31', schedule: 'G', gstRate: 12 },
                { medicineName: 'Iron & Folic Acid Tab', genericName: 'Ferrous Ascorbate', dosage: '100mg', unitPrice: 6.50, stock: 500, batchNumber: 'BAT-2026-05', expiryDate: '2028-11-30', schedule: 'H', gstRate: 12 },
                { medicineName: 'Pantoprazole 40mg', genericName: 'Pantoprazole', dosage: '40mg', unitPrice: 7.00, stock: 400, batchNumber: 'BAT-2026-06', expiryDate: '2028-09-30', schedule: 'H', gstRate: 12 },
                { medicineName: 'Cefixime 200mg', genericName: 'Cefixime', dosage: '200mg', unitPrice: 14.00, stock: 300, batchNumber: 'BAT-2026-07', expiryDate: '2028-07-31', schedule: 'H', gstRate: 12 },
                { medicineName: 'ORS Electral Powder', genericName: 'Oral Rehydration Salts', dosage: '21.8g', unitPrice: 22.00, stock: 250, batchNumber: 'BAT-2026-08', expiryDate: '2029-01-31', schedule: 'G', gstRate: 5 },
                { medicineName: 'Dydrogesterone 10mg', genericName: 'Dydrogesterone', dosage: '10mg', unitPrice: 55.00, stock: 150, batchNumber: 'BAT-2026-09', expiryDate: '2028-06-30', schedule: 'H', gstRate: 12 },
                { medicineName: 'Progesterone 200mg SR', genericName: 'Progesterone', dosage: '200mg', unitPrice: 38.00, stock: 200, batchNumber: 'BAT-2026-10', expiryDate: '2028-04-30', schedule: 'H', gstRate: 12 }
            ];
            defaultMeds.forEach(function (m, idx) {
                var id = 'MED-' + (idx + 1);
                m.id = id;
                m.medicineId = id;
                m.category = 'Medicine';
                pharma[id] = m;
            });
            _saveCollection('pharmacy');
        }
    }

    _seedInitialHospitalData();

    // Create singleton instances
    var authInstance = new AuthInstance();
    var firestoreInstance = new FirestoreInstance();

    // Functions shim (handles callable functions locally)
    var functionsInstance = {
        httpsCallable: function (name) {
            return function (data) {
                if (name === 'syncStaffUid' || name === 'syncStaffProfile' || name === 'refreshPublicDisplays') {
                    return Promise.resolve({ data: { success: true } });
                }
                if (name === 'applyHospitalPolicy') {
                    return Promise.resolve({ data: { success: true, policy: 'RxPx Hospitals Policy 2026' } });
                }
                if (name === 'issueHospitalCertificate') {
                    var year = new Date().getFullYear();
                    var num = 'RXPX-CERT-' + year + '-' + Math.floor(Math.random() * 90000 + 10000);
                    return Promise.resolve({ data: { certificateNumber: num, issuedAt: new Date().toISOString() } });
                }
                return Promise.resolve({ data: { success: true } });
            };
        },
        useEmulator: function () {}
    };

    var storageInstance = {
        ref: function () {
            return {
                put: function () { return Promise.resolve({ ref: { getDownloadURL: function () { return Promise.resolve(''); } } }); },
                getDownloadURL: function () { return Promise.resolve(''); }
            };
        },
        useEmulator: function () {}
    };

    // Firebase Namespace
    var localFirebase = {
        _isLocalDb: true,
        apps: [{ name: '[DEFAULT]' }],
        initializeApp: function () { return localFirebase; },
        app: function () { return localFirebase; },
        auth: function () { return authInstance; },
        firestore: function () { return firestoreInstance; },
        functions: function () { return functionsInstance; },
        storage: function () { return storageInstance; }
    };

    localFirebase.firestore.FieldValue = {
        serverTimestamp: function () { return { _isFieldValueServerTimestamp: true }; },
        increment: function (n) { return { _isFieldValueIncrement: true, amount: n }; },
        arrayUnion: function () {
            var args = Array.prototype.slice.call(arguments);
            return { _isFieldValueArrayUnion: true, elements: args };
        },
        arrayRemove: function () {
            var args = Array.prototype.slice.call(arguments);
            return { _isFieldValueArrayRemove: true, elements: args };
        }
    };

    localFirebase.firestore.Timestamp = {
        fromDate: function (d) {
            var sec = Math.floor(d.getTime() / 1000);
            return {
                _isTimestamp: true,
                seconds: sec,
                nanoseconds: 0,
                toDate: function () { return new Date(sec * 1000); }
            };
        },
        now: function () {
            var sec = Math.floor(Date.now() / 1000);
            return {
                _isTimestamp: true,
                seconds: sec,
                nanoseconds: 0,
                toDate: function () { return new Date(sec * 1000); }
            };
        }
    };

    // Global exports
    global.firebase = localFirebase;
    global.auth = authInstance;
    global.db = firestoreInstance;
    global.claimSession = function () { return Promise.resolve(); };

    // Backup & Restore utilities
    global.exportHospitalDatabase = function () {
        var backup = {};
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && (k.startsWith('rxpx_col_') || k.startsWith('jmh_col_'))) {
                backup[k] = localStorage.getItem(k);
            }
        }
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rxpx-hospitals-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    global.importHospitalDatabase = function (jsonStr) {
        try {
            var parsed = JSON.parse(jsonStr);
            Object.keys(parsed).forEach(function (k) {
                if (k.startsWith('rxpx_col_') || k.startsWith('jmh_col_')) {
                    localStorage.setItem(k, parsed[k]);
                }
            });
            alert('Database restored successfully! The page will now reload.');
            window.location.reload();
        } catch (e) {
            alert('Invalid backup file: ' + e.message);
        }
    };

    global.resetHospitalDatabase = function () {
        if (!confirm('Are you sure you want to reset all hospital data to defaults? This cannot be undone.')) return;
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && (k.startsWith('rxpx_col_') || k.startsWith('jmh_col_'))) toRemove.push(k);
        }
        toRemove.forEach(function (k) { localStorage.removeItem(k); });
        _memoryStore = {};
        _seedInitialHospitalData();
        window.location.reload();
    };

})(typeof window !== 'undefined' ? window : global);
