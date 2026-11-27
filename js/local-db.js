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

    function _makeTimestamp(sec, ms) {
        var seconds = Number.isFinite(sec) ? sec : Math.floor((ms || Date.now()) / 1000);
        return {
            _isTimestamp: true,
            seconds: seconds,
            nanoseconds: 0,
            toDate: function () { return new Date(this.seconds * 1000); },
            toMillis: function () { return this.seconds * 1000; }
        };
    }

    function _clone(val) {
        if (val === undefined || val === null) return val;
        if (typeof val === 'object') {
            if (val._isTimestamp) {
                return _makeTimestamp(val.seconds);
            }
            if (val instanceof Date) {
                return _makeTimestamp(Math.floor(val.getTime() / 1000));
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

    function _setByPath(obj, pathStr, val, isDelete) {
        var parts = pathStr.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            var p = parts[i];
            if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
                if (isDelete) return;
                cur[p] = {};
            }
            cur = cur[p];
        }
        var last = parts[parts.length - 1];
        if (isDelete) delete cur[last];
        else cur[last] = val;
    }

    function _resolveFieldValues(data, existing) {
        var result = _clone(existing || {}) || {};
        Object.keys(data || {}).forEach(function (key) {
            var val = data[key];
            var resolved;
            var isDelete = !!(val && val._isFieldValueDelete);
            if (isDelete) {
                if (key.indexOf('.') !== -1) _setByPath(result, key, undefined, true);
                else delete result[key];
                return;
            }
            if (val && val._isFieldValueServerTimestamp) {
                resolved = _makeTimestamp(Math.floor(Date.now() / 1000));
            } else if (val && val._isFieldValueIncrement) {
                var currentNum = key.indexOf('.') !== -1 ? _extractVal(result, key) : result[key];
                resolved = Number(currentNum || 0) + Number(val.amount || 0);
            } else if (val && val._isFieldValueArrayUnion) {
                var existingArr = key.indexOf('.') !== -1 ? _extractVal(result, key) : result[key];
                var arr = Array.isArray(existingArr) ? existingArr.slice() : [];
                (val.elements || []).forEach(function (el) {
                    if (arr.indexOf(el) === -1) arr.push(el);
                });
                resolved = arr;
            } else if (val && val._isFieldValueArrayRemove) {
                var curArrVal = key.indexOf('.') !== -1 ? _extractVal(result, key) : result[key];
                var currentArr = Array.isArray(curArrVal) ? curArrVal.slice() : [];
                (val.elements || []).forEach(function (el) {
                    var idx = currentArr.indexOf(el);
                    if (idx !== -1) currentArr.splice(idx, 1);
                });
                resolved = currentArr;
            } else {
                resolved = _clone(val);
            }
            if (key.indexOf('.') !== -1) _setByPath(result, key, resolved, false);
            else result[key] = resolved;
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
        return _clone(this._data);
    };
    DocumentSnapshot.prototype.get = function (fieldPath) {
        if (!this._data || !fieldPath) return undefined;
        var val = _extractVal(this._data, String(fieldPath));
        return _clone(val);
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
        var parts = String(collectionName || '').split('_');
        this.parent = {
            id: parts[parts.length - 1] || collectionName,
            path: collectionName
        };
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
    function Query(collectionName, filters, sorts, limitNum, bounds, isCollectionGroup) {
        this.collectionName = collectionName;
        this.filters = filters || [];
        this.sorts = sorts || [];
        this.limitNum = limitNum || null;
        this.bounds = bounds || {};
        this.isCollectionGroup = !!isCollectionGroup;
    }

    Query.prototype.where = function (field, op, val) {
        var newFilters = this.filters.concat([{ field: field, op: op, val: val }]);
        return new Query(this.collectionName, newFilters, this.sorts, this.limitNum, this.bounds, this.isCollectionGroup);
    };

    Query.prototype.orderBy = function (field, dir) {
        var newSorts = this.sorts.concat([{ field: field, dir: dir || 'asc' }]);
        return new Query(this.collectionName, this.filters, newSorts, this.limitNum, this.bounds, this.isCollectionGroup);
    };

    Query.prototype.limit = function (n) {
        return new Query(this.collectionName, this.filters, this.sorts, n, this.bounds, this.isCollectionGroup);
    };

    Query.prototype.startAt = function () {
        var nextBounds = Object.assign({}, this.bounds, { start: { values: Array.prototype.slice.call(arguments), inclusive: true } });
        return new Query(this.collectionName, this.filters, this.sorts, this.limitNum, nextBounds, this.isCollectionGroup);
    };

    Query.prototype.startAfter = function () {
        var nextBounds = Object.assign({}, this.bounds, { start: { values: Array.prototype.slice.call(arguments), inclusive: false } });
        return new Query(this.collectionName, this.filters, this.sorts, this.limitNum, nextBounds, this.isCollectionGroup);
    };

    Query.prototype.endAt = function () {
        var nextBounds = Object.assign({}, this.bounds, { end: { values: Array.prototype.slice.call(arguments), inclusive: true } });
        return new Query(this.collectionName, this.filters, this.sorts, this.limitNum, nextBounds, this.isCollectionGroup);
    };

    Query.prototype.endBefore = function () {
        var nextBounds = Object.assign({}, this.bounds, { end: { values: Array.prototype.slice.call(arguments), inclusive: false } });
        return new Query(this.collectionName, this.filters, this.sorts, this.limitNum, nextBounds, this.isCollectionGroup);
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

    function _compareDocTuple(item, sorts, cursorVals) {
        for (var i = 0; i < cursorVals.length && i < sorts.length; i++) {
            var s = sorts[i];
            var cur = cursorVals[i];
            if (cur && typeof cur.data === 'function') {
                cur = _extractVal(cur.data(), s.field);
            }
            var val = _extractVal(item, s.field);
            if (val === undefined) return s.dir === 'desc' ? 1 : -1;
            var cmp = _compareValues(val, cur);
            if (s.dir === 'desc') cmp = -cmp;
            if (cmp !== 0) return cmp;
        }
        return 0;
    }

    function _collectCollectionNamesForGroup(subName) {
        var names = new Set();
        names.add(subName);
        var suffix = '_' + subName;
        Object.keys(_memoryStore).forEach(function (k) {
            if (k === subName || k.slice(-suffix.length) === suffix) names.add(k);
        });
        if (_hasLocalStorage()) {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (!key) continue;
                var rawName = null;
                if (key.indexOf('rxpx_col_') === 0) rawName = key.slice('rxpx_col_'.length);
                else if (key.indexOf('jmh_col_') === 0) rawName = key.slice('jmh_col_'.length);
                if (rawName && (rawName === subName || rawName.slice(-suffix.length) === suffix)) {
                    names.add(rawName);
                }
            }
        }
        return Array.from(names);
    }

    Query.prototype._execute = function () {
        var self = this;
        var docs = [];
        var collectionNames = this.isCollectionGroup ? _collectCollectionNamesForGroup(this.collectionName) : [this.collectionName];

        collectionNames.forEach(function (colName) {
            var col = _loadCollection(colName);
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
                    } else if (f.op === 'not-in') {
                        if (Array.isArray(target) && target.indexOf(cmpV) !== -1) { matches = false; break; }
                    } else if (f.op === 'array-contains') {
                        if (!Array.isArray(v) || v.indexOf(target) === -1) { matches = false; break; }
                    } else if (f.op === 'array-contains-any') {
                        if (!Array.isArray(v) || !Array.isArray(target) || !target.some(function (t) { return v.indexOf(t) !== -1; })) { matches = false; break; }
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

                if (matches && (self.bounds.start || self.bounds.end) && self.sorts.length > 0) {
                    var firstField = self.sorts[0].field;
                    if (_extractVal(item, firstField) === undefined) matches = false;
                    if (matches && self.bounds.start) {
                        var scmp = _compareDocTuple(item, self.sorts, self.bounds.start.values);
                        if (self.bounds.start.inclusive ? scmp < 0 : scmp <= 0) matches = false;
                    }
                    if (matches && self.bounds.end) {
                        var ecmp = _compareDocTuple(item, self.sorts, self.bounds.end.values);
                        if (self.bounds.end.inclusive ? ecmp > 0 : ecmp >= 0) matches = false;
                    }
                }

                if (matches) {
                    docs.push(new DocumentSnapshot(docId, item, new DocumentReference(colName, docId)));
                }
            });
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
    FirestoreInstance.prototype.collectionGroup = function (subName) {
        return new Query(subName, [], [], null, {}, true);
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

    var _SEED_PASSWORDS = {
        'admin': 'Rxpx@12345',
        'reception': 'Receptionist@12345',
        'pooja': 'Pooja@12345',
        'ramakanth': 'Ramakanth@12345',
        'lab': 'Lab@12345',
        'pharmacy': 'Pharmacy@12345'
    };

    var SEED_STAFF = {
        'admin': {
            uid: 'admin', id: 'admin', docId: 'admin',
            name: 'RxPx Administrator', email: 'admin@rxpx.com',
            role: 'admin', isAdmin: true, department: 'Administration', isActive: true, hasLogin: true, phone: '9949979578'
        },
        'reception': {
            uid: 'reception', id: 'reception', docId: 'reception',
            name: 'Reception Desk', email: 'reception@rxpx.com',
            role: 'receptionist', department: 'Reception', isActive: true, hasLogin: true, phone: '9949979578'
        },
        'pooja': {
            uid: 'pooja', id: 'pooja', docId: 'pooja',
            name: 'Dr. G. Pooja', email: 'pooja@rxpx.com',
            role: 'doctor', isAdmin: true,
            specialisation: 'Obstetrician and Gynaecologist (MBBS, MS OBG)',
            services: ['Normal Delivery', 'C-Section', 'Antenatal Care', 'PCOD / PCOS Management', 'Fibroids Management', 'Family Planning', 'Infertility Evaluation & Treatment', 'Cancer Screening', 'Menstrual Cycle Issues', 'Menopause Care', 'Vaccinations', "General Women's Health Care"],
            department: 'Obstetrics & Gynaecology', opFee: 300, freeOP: false,
            isActive: true, hasLogin: true, phone: '9949979578'
        },
        'ramakanth': {
            uid: 'ramakanth', id: 'ramakanth', docId: 'ramakanth',
            name: 'Dr. Ramakanth Reddy', email: 'ramakanth@rxpx.com',
            role: 'doctor', isAdmin: true,
            specialisation: 'Family Physician & Diabetologist (Director)',
            services: ['Diabetes Screening & Diagnosis', 'Personalized Diet & Lifestyle Guidance', 'Diabetes Management Programs', 'General Medicine Care', 'Patient Education & Support', 'Regular Sugar Monitoring', 'Personalized Treatment & Insulin Care', 'Heart Health & Complication Prevention'],
            department: 'Family Medicine & Diabetology', opFee: 300, freeOP: false,
            isActive: true, hasLogin: true, phone: '9949979578'
        },
        'lab': {
            uid: 'lab', id: 'lab', docId: 'lab',
            name: 'Laboratory Desk', email: 'lab@rxpx.com',
            role: 'lab_technician', department: 'Laboratory',
            isActive: true, hasLogin: true, phone: '9949979578'
        },
        'pharmacy': {
            uid: 'pharmacy', id: 'pharmacy', docId: 'pharmacy',
            name: 'Pharmacy Desk', email: 'pharmacy@rxpx.com',
            role: 'pharmacist', department: 'Pharmacy',
            isActive: true, hasLogin: true, phone: '9949979578'
        }
    };

    function AuthInstance() {
        if (_hasLocalStorage()) {
            var saved = localStorage.getItem('rxpx_active_user') || localStorage.getItem('jmh_active_user');
            if (saved) {
                try {
                    var parsed = JSON.parse(saved);
                    if (parsed && typeof parsed === 'object') {
                        delete parsed.password;
                        _currentUser = parsed;
                    }
                } catch (e) {}
            }
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
        var matchedKey = null;
        var col = _loadCollection('staff');

        Object.keys(col).forEach(function (k) {
            var s = col[k];
            if (s && s.email) {
                var sLower = s.email.toLowerCase();
                var sPrefix = sLower.split('@')[0];
                if (sLower === lower || sPrefix === prefix || (sPrefix + '@rxpx.com' === lower) || (sPrefix + '@rxpx.in' === lower)) {
                    matched = Object.assign({ uid: s.uid || k, id: k, docId: k }, s);
                    matchedKey = k;
                }
            }
        });
        if (!matched) {
            Object.keys(SEED_STAFF).forEach(function (k) {
                var s = SEED_STAFF[k];
                var sLower = s.email.toLowerCase();
                var sPrefix = s.uid.toLowerCase();
                if (sLower === lower || sPrefix === prefix || (sPrefix + '@rxpx.com' === lower) || (sPrefix + '@rxpx.in' === lower) || s.name.toLowerCase() === lower) {
                    matched = Object.assign({}, s);
                    matchedKey = k;
                }
            });
        }
        if (!matched) {
            var err = new Error('No account found with this email address.');
            err.code = 'auth/user-not-found';
            return Promise.reject(err);
        }
        var localAuthCol = _loadCollection('_localAuth');
        var authRecord = localAuthCol[matched.uid] || localAuthCol[matchedKey] || localAuthCol[lower];
        var expectedPassword = (authRecord && authRecord.password) || matched.password || _SEED_PASSWORDS[matched.uid] || _SEED_PASSWORDS[matchedKey];
        if (expectedPassword && password !== expectedPassword) {
            var isAltReception = (matched.uid === 'reception' || matchedKey === 'reception') &&
                                 (password === 'Receptionist@12345' || password === 'Rxpx@12345');
            if (!isAltReception) {
                var pwdErr = new Error('Incorrect email or password.');
                pwdErr.code = 'auth/invalid-credential';
                return Promise.reject(pwdErr);
            }
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
        return this.signInWithEmailAndPassword(matched.email, _SEED_PASSWORDS[roleKey]);
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

    // Secondary Auth instance (used when Admin creates staff logins without signing themselves out)
    var secondaryAuthInstance = {
        currentUser: null,
        createUserWithEmailAndPassword: function (email, password) {
            var lower = String(email || '').toLowerCase().trim();
            if (!lower) {
                var e1 = new Error('Valid email is required.');
                e1.code = 'auth/invalid-email';
                return Promise.reject(e1);
            }
            if (!password || String(password).length < 6) {
                var e2 = new Error('Password must be at least 6 characters.');
                e2.code = 'auth/weak-password';
                return Promise.reject(e2);
            }
            var localAuthCol = _loadCollection('_localAuth');
            var uid = 'uid_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
            Object.keys(localAuthCol).forEach(function (k) {
                if (localAuthCol[k] && String(localAuthCol[k].email || '').toLowerCase() === lower) {
                    uid = localAuthCol[k].uid || k;
                }
            });
            localAuthCol[uid] = { uid: uid, email: lower, password: String(password) };
            _saveCollection('_localAuth');
            var userObj = {
                uid: uid,
                email: lower,
                delete: function () {
                    var authMap = _loadCollection('_localAuth');
                    delete authMap[uid];
                    _saveCollection('_localAuth');
                    return Promise.resolve();
                }
            };
            return Promise.resolve({ user: userObj });
        },
        signOut: function () {
            this.currentUser = null;
            return Promise.resolve();
        },
        useEmulator: function () {}
    };

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
        // 1. Staff — seed missing accounts and strip plaintext passwords out of /staff docs
        var staffCol = _loadCollection('staff');
        var localAuthCol = _loadCollection('_localAuth');
        var authChanged = false;
        Object.keys(SEED_STAFF).forEach(function (k) {
            var seed = SEED_STAFF[k];
            var existing = staffCol[k];
            if (!existing) {
                staffCol[k] = Object.assign({}, seed);
            } else {
                if (existing.password) {
                    if (!localAuthCol[k]) {
                        localAuthCol[k] = { uid: k, email: seed.email, password: existing.password };
                        authChanged = true;
                    }
                    delete existing.password;
                }
                Object.keys(seed).forEach(function (field) {
                    if (field === 'isActive' && existing.isActive !== undefined) return;
                    existing[field] = Array.isArray(seed[field]) ? seed[field].slice() : seed[field];
                });
            }
            if (!localAuthCol[k] || localAuthCol[k].email !== seed.email || (k === 'reception' && localAuthCol[k].password !== 'Receptionist@12345')) {
                localAuthCol[k] = { uid: k, email: seed.email, password: _SEED_PASSWORDS[k] };
                authChanged = true;
            }
        });
        _saveCollection('staff');
        if (authChanged) _saveCollection('_localAuth');

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

    function _issueLocalCertificate(input) {
        input = input || {};
        if (!authInstance.currentUser) {
            return Promise.reject(new Error('Please sign in first.'));
        }
        var role = String(authInstance.currentUser.role || '').toLowerCase();
        var effectiveAdmin = role === 'admin' || authInstance.currentUser.isAdmin === true;
        var types = {
            birth: { prefix: 'BC', roles: ['admin', 'doctor', 'nurse', 'receptionist'] },
            delivery: { prefix: 'DC', roles: ['admin', 'doctor', 'nurse'] },
            medical: { prefix: 'MC', roles: ['admin', 'doctor'] },
            fitness: { prefix: 'FC', roles: ['admin', 'doctor'] }
        };
        var typeConf = types[input.type];
        if (!typeConf || (!effectiveAdmin && typeConf.roles.indexOf(role) === -1)) {
            return Promise.reject(new Error('This role cannot issue this certificate type.'));
        }
        if (typeof input.patientDocId !== 'string' || !input.patientDocId || input.patientDocId.indexOf('/') !== -1) {
            return Promise.reject(new Error('Select a valid patient.'));
        }
        if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId)) {
            return Promise.reject(new Error('A valid issuance request ID is required.'));
        }
        var data = input.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return Promise.reject(new Error('Certificate details are invalid.'));
        }
        var required = {
            birth: ['babyGender', 'dateOfBirth', 'fatherName', 'conductedBy'],
            delivery: ['deliveryDate', 'deliveryType', 'conductedBy'],
            medical: ['age', 'examinedOn', 'diagnosis', 'restFrom', 'restTo'],
            fitness: ['age', 'examinedOn', 'fitFor']
        };
        if (required[input.type].some(function (key) { return data[key] === undefined || data[key] === null || String(data[key]).trim() === ''; })) {
            return Promise.reject(new Error('Complete the required certificate fields.'));
        }
        if ((data.restFrom && data.restTo && data.restTo < data.restFrom) || (data.fitFrom && data.validUntil && data.validUntil < data.fitFrom)) {
            return Promise.reject(new Error('Certificate date range is invalid.'));
        }

        var year = new Date().getFullYear();
        var prefix = 'RXPX/' + typeConf.prefix + '/' + year + '/';
        var certRef = firestoreInstance.collection('certificates').doc(input.requestId);
        var counterRef = firestoreInstance.collection('certificateCounters').doc(typeConf.prefix + '-' + year);

        return firestoreInstance.collection('certificates').where('certificateType', '==', input.type).get().then(function (prior) {
            var priorMax = 0;
            prior.forEach(function (doc) {
                var numStr = String(doc.get('certificateNo') || '');
                if (numStr.indexOf(prefix) === 0 && /^\d+$/.test(numStr.slice(prefix.length))) {
                    priorMax = Math.max(priorMax, Number(numStr.slice(prefix.length)));
                }
            });
            return firestoreInstance.runTransaction(function (tx) {
                return Promise.all([
                    tx.get(certRef),
                    tx.get(counterRef),
                    tx.get(firestoreInstance.collection('patients').doc(input.patientDocId))
                ]).then(function (snaps) {
                    var existing = snaps[0], counter = snaps[1], patient = snaps[2];
                    var actor = authInstance.currentUser.email || authInstance.currentUser.uid;
                    if (existing.exists) {
                        return { data: { id: certRef.id, certificateNo: existing.get('certificateNo'), alreadyIssued: true } };
                    }
                    if (!patient.exists) {
                        throw new Error('Patient record was not found.');
                    }
                    var sequence = Math.max(priorMax, counter.exists ? Number(counter.get('count')) || 0 : 0) + 1;
                    var certificateNo = prefix + String(sequence).padStart(5, '0');
                    tx.set(counterRef, { count: sequence, year: year, certificateType: input.type }, { merge: true });
                    tx.set(certRef, {
                        certificateNo: certificateNo,
                        certificateType: input.type,
                        patientId: patient.get('patientId') || '',
                        patientDocId: patient.id,
                        patientName: patient.get('name') || '',
                        data: data,
                        issuedByName: data.issuedByName || authInstance.currentUser.name || actor,
                        issuedByQualification: data.issuedByQualification || authInstance.currentUser.specialisation || 'Medical Officer',
                        issuedByRegistration: data.issuedByRegistration || authInstance.currentUser.registrationNo || '',
                        issuedByRole: role,
                        recordedBy: actor,
                        status: 'issued',
                        createdAt: localFirebase.firestore.FieldValue.serverTimestamp()
                    });
                    return { data: { id: certRef.id, certificateNo: certificateNo, alreadyIssued: false } };
                });
            });
        });
    }

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
                    return _issueLocalCertificate(data);
                }
                if (name === 'startFirestoreBackup') {
                    var stamp = new Date().toISOString().slice(0, 10);
                    if (typeof global.exportHospitalDatabase === 'function' && typeof document !== 'undefined') {
                        try { global.exportHospitalDatabase(); } catch (e) {}
                    }
                    return Promise.resolve({ data: { outputUriPrefix: 'local-backup://rxpx-hospitals-backup-' + stamp + '.json' } });
                }
                if (['getCalendarFeedUrl', 'abdmRequestOtp', 'abdmVerifyAndLink', 'abdmUnlink', 'createRazorpayOrder', 'verifyRazorpayPayment', 'sendBillWhatsApp', 'sendBillEmail', 'sendPatientSms'].indexOf(name) !== -1) {
                    return Promise.reject(new Error('External cloud integration (' + name + ') is unavailable in standalone local mode.'));
                }
                return Promise.resolve({ data: { success: true } });
            };
        },
        useEmulator: function () {}
    };

    // --- Storage shim with UploadTask + DataURL local persistence ---
    var _memoryStorageFiles = {};
    var _memoryStorageMeta = {};

    function _saveStoredFile(pathStr, dataUrl, meta) {
        _memoryStorageFiles[pathStr] = dataUrl;
        _memoryStorageMeta[pathStr] = meta;
        if (_hasLocalStorage()) {
            try {
                localStorage.setItem('rxpx_file_' + pathStr, JSON.stringify({ dataUrl: dataUrl, meta: meta }));
            } catch (e) {
                // Quota exceeded: still kept in _memoryStorageFiles for current tab
            }
        }
    }

    function _loadStoredFile(pathStr) {
        if (_memoryStorageFiles[pathStr]) {
            return { dataUrl: _memoryStorageFiles[pathStr], meta: _memoryStorageMeta[pathStr] || {} };
        }
        if (_hasLocalStorage()) {
            var raw = localStorage.getItem('rxpx_file_' + pathStr);
            if (raw) {
                try {
                    var parsed = JSON.parse(raw);
                    _memoryStorageFiles[pathStr] = parsed.dataUrl;
                    _memoryStorageMeta[pathStr] = parsed.meta || {};
                    return parsed;
                } catch (e) {}
            }
        }
        return null;
    }

    function _readFileAsDataUrl(file, fallbackType) {
        return new Promise(function (resolve, reject) {
            if (!file) return resolve('data:application/octet-stream;base64,');
            if (typeof FileReader !== 'undefined' && typeof Blob !== 'undefined' && file instanceof Blob) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result || ''); };
                reader.onerror = function () { reject(new Error('Failed to read file.')); };
                reader.readAsDataURL(file);
                return;
            }
            // Fallback for Uint8Array / plain buffers
            try {
                var bytes = file instanceof Uint8Array ? file : new Uint8Array(file.buffer || file);
                var bin = '';
                for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
                var b64 = typeof btoa === 'function' ? btoa(bin) : '';
                resolve('data:' + (fallbackType || 'application/octet-stream') + ';base64,' + b64);
            } catch (e) {
                resolve('data:' + (fallbackType || 'application/octet-stream') + ';base64,');
            }
        });
    }

    function _createStorageRef(pathStr) {
        var cleanPath = String(pathStr || ('file_' + Date.now()));
        var refObj = {
            fullPath: cleanPath,
            name: cleanPath.split('/').pop(),
            getDownloadURL: function () {
                var entry = _loadStoredFile(cleanPath);
                return Promise.resolve(entry ? entry.dataUrl : '');
            },
            getMetadata: function () {
                var entry = _loadStoredFile(cleanPath);
                return Promise.resolve(entry ? entry.meta : { fullPath: cleanPath, contentType: 'application/octet-stream', size: 0 });
            },
            put: function (file, metadata) {
                var total = (file && (file.size || file.byteLength || file.length)) || 0;
                var contentType = (metadata && metadata.contentType) || (file && file.type) || 'application/octet-stream';
                var meta = {
                    fullPath: cleanPath,
                    name: (file && file.name) || cleanPath.split('/').pop(),
                    contentType: contentType,
                    size: total,
                    updated: new Date().toISOString()
                };
                var snapshotObj = { bytesTransferred: 0, totalBytes: total, state: 'running', ref: refObj, metadata: meta };
                var progressCbs = [], errorCbs = [], completeCbs = [];

                var promise = _readFileAsDataUrl(file, contentType).then(function (dataUrl) {
                    _saveStoredFile(cleanPath, dataUrl, meta);
                    snapshotObj.bytesTransferred = total;
                    snapshotObj.state = 'success';
                    progressCbs.forEach(function (cb) { try { cb(snapshotObj); } catch (e) {} });
                    completeCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
                    return snapshotObj;
                }).catch(function (err) {
                    errorCbs.forEach(function (cb) { try { cb(err); } catch (e) {} });
                    throw err;
                });

                var task = {
                    snapshot: snapshotObj,
                    on: function (eventName, nextCb, errCb, completeCb) {
                        if (typeof nextCb === 'function') progressCbs.push(nextCb);
                        else if (nextCb && typeof nextCb === 'object') {
                            if (typeof nextCb.next === 'function') progressCbs.push(nextCb.next);
                            if (typeof nextCb.error === 'function') errorCbs.push(nextCb.error);
                            if (typeof nextCb.complete === 'function') completeCbs.push(nextCb.complete);
                        }
                        if (typeof errCb === 'function') errorCbs.push(errCb);
                        if (typeof completeCb === 'function') completeCbs.push(completeCb);
                        return function () {};
                    },
                    then: function (onFulfilled, onRejected) { return promise.then(onFulfilled, onRejected); },
                    catch: function (onRejected) { return promise.catch(onRejected); }
                };
                return task;
            }
        };
        return refObj;
    }

    var storageInstance = {
        ref: function (pathStr) {
            return _createStorageRef(pathStr);
        },
        useEmulator: function () {}
    };

    var DEFAULT_OPTIONS = {
        apiKey: 'local-standalone-key',
        authDomain: 'rxpx-hms.local',
        projectId: 'rxpx-hms-local',
        storageBucket: 'rxpx-hms.local',
        appId: '1:123456789:web:local'
    };

    function _makeAppObj(name, isSecondary) {
        return {
            name: name,
            options: Object.assign({}, DEFAULT_OPTIONS),
            auth: function () { return isSecondary ? secondaryAuthInstance : authInstance; },
            firestore: function () { return firestoreInstance; },
            functions: function () { return functionsInstance; },
            storage: function () { return storageInstance; }
        };
    }

    var _defaultApp = _makeAppObj('[DEFAULT]', false);
    var _appsMap = { '[DEFAULT]': _defaultApp };

    // Firebase Namespace
    var localFirebase = {
        _isLocalDb: true,
        apps: [_defaultApp],
        initializeApp: function (options, name) {
            var appName = name || '[DEFAULT]';
            if (!_appsMap[appName]) {
                var appObj = _makeAppObj(appName, appName !== '[DEFAULT]');
                _appsMap[appName] = appObj;
                localFirebase.apps.push(appObj);
            }
            return _appsMap[appName];
        },
        app: function (name) {
            var appName = name || '[DEFAULT]';
            return _appsMap[appName] || _defaultApp;
        },
        auth: function () { return authInstance; },
        firestore: function () { return firestoreInstance; },
        functions: function () { return functionsInstance; },
        storage: function () { return storageInstance; }
    };

    localFirebase.firestore.FieldValue = {
        serverTimestamp: function () { return { _isFieldValueServerTimestamp: true }; },
        increment: function (n) { return { _isFieldValueIncrement: true, amount: n }; },
        delete: function () { return { _isFieldValueDelete: true }; },
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
            return _makeTimestamp(Math.floor(d.getTime() / 1000));
        },
        fromMillis: function (ms) {
            return _makeTimestamp(Math.floor(Number(ms || 0) / 1000));
        },
        now: function () {
            return _makeTimestamp(Math.floor(Date.now() / 1000));
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
