(function (root) {
    'use strict';
    var policy = {
        version: '2026-11-27',
        departments: ['Obstetrics & Gynaecology', 'Family Medicine & Diabetology'],
        fees: { newOP: 300, freeReviewDays: 7, review: 100, generalAfterMonth: 200, generalAfterThreeMonths: 300, phoneSurcharge: 100 },
        // The laboratory catalog mirrors the photographed "Laboratory
        // Investigations" price list. Only the seven clearly reproductive /
        // women's-health investigations are routed to the OBG department;
        // every other investigation is routed to Family Medicine.
        womenHealthLabIds: ['BetaHCG', 'Estrogen', 'Progesterone', 'FSH', 'LH', 'Prolactin', 'AMH'],
        labs: [
            ['CBP', 'Complete Blood Picture (CBP)', 250],
            ['BloodGrouping', 'Blood Grouping', 50],
            ['ESR', 'ESR', 100],
            ['FBS', 'FBS', 50],
            ['PPBS', 'PPBS', 50],
            ['HbA1c', 'HbA1c', 500],
            ['RBS', 'RBS', 50],
            ['CUE', 'CUE', 200],
            ['RFT', 'RFT', 500],
            ['LFT', 'LFT', 500],
            ['SerumCreatinine', 'Serum Creatinine', 200],
            ['ECG', 'ECG', 300],
            ['MPCard', 'MP Card (Malaria)', 150],
            ['WidalTyphoid', 'Widal (Typhoid)', 100],
            ['Dengue', 'Dengue', 500],
            ['SerumElectrolytes', 'Serum Electrolytes', 700],
            ['Bilirubin', 'Bilirubin', 100],
            ['SerumUricAcid', 'Serum Uric Acid', 200],
            ['RAFactor', 'RA Factor', 200],
            ['LipidProfile', 'Lipid Profile', 500],
            ['UrineKetoneBodies', 'Urine Ketone Bodies', 200],
            ['ThyroidProfile', 'Thyroid Profile', 600],
            ['CRP', 'CRP', 300],
            ['TSH', 'TSH', 200],
            ['T3T4', 'T3 & T4', 250],
            ['HCV', 'HCV', 250],
            ['HIV', 'HIV', 500],
            ['VDRL', 'VDRL', 200],
            ['HBsAg', 'HBsAg', 150],
            ['SerumCalcium', 'Serum Calcium', 200],
            ['VitaminB12', 'Vitamin B12', 1000],
            ['VitaminD3', 'Vitamin D3', 1000],
            ['CPKCKMB', 'CPK & CK-MB', 500],
            ['SerumAmylase', 'Serum Amylase', 200],
            ['TroponinI', 'Troponin I', 1800],
            ['BTCT', 'BT - CT', 100],
            ['APTT', 'APTT', 350],
            ['PTINR', 'PT - INR', 350],
            ['BetaHCG', 'Beta - hCG', 600],
            ['ASO', 'ASO', 200],
            ['ScrubTyphusIgM', 'Scrub Typhus IgM', 500],
            ['Estrogen', 'Estrogen', 1000],
            ['Progesterone', 'Progesterone', 1000],
            ['FSH', 'FSH', 800],
            ['LH', 'LH', 800],
            ['Prolactin', 'Prolactin', 1000],
            ['Testosterone', 'Testosterone', 1000],
            ['AMH', 'AMH', 2000],
            ['NTproBNP', 'NT - proBNP', 2000],
            ['CRPDilution', 'CRP (Dilution)', 300]
        ].map(function (row) {
            return {
                id: row[0],
                name: row[1],
                price: row[2],
                category: 'Lab',
                womenHealth: false
            };
        }),
        imaging: [
            { id: 'CTG', name: 'CTG', price: 500, type: 'CTG', category: 'Imaging' },
            { id: 'UltrasoundAbdomen', name: 'USG Abdomen', price: 500, type: 'Ultrasound', category: 'Imaging' },
            { id: 'VaginalScan', name: 'Vaginal Scan', price: 550, type: 'Ultrasound', category: 'Imaging' }
        ]
    };
    // The catalog mapper above is intentionally data-only. Add the routing
    // flag in a second pass so it remains correct if the policy object is
    // copied or extended later.
    policy.labs.forEach(function (test) {
        test.womenHealth = policy.womenHealthLabIds.indexOf(test.id) !== -1;
        test.department = test.womenHealth ? policy.departments[0] : policy.departments[1];
    });
    function day(value) {
        if (!value) return null;
        if (value.toDate) value = value.toDate();
        var match = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        var date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
        if (isNaN(date.getTime())) return null;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }
    function addMonths(value, months) {
        var date = day(value), originalDay = date.getDate();
        date.setDate(1); date.setMonth(date.getMonth() + months);
        date.setDate(Math.min(originalDay, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
        return date;
    }
    // Follow-up eligibility is anchored to the last new/full-fee OP episode,
    // rather than extended indefinitely by each discounted review.
    function calculateFee(options) {
        options = options || {};
        var at = day(options.date) || day(new Date());
        var previous = day(options.lastVisitDate), anchor = day(options.episodeDate) || previous;
        var fee = policy.fees.newOP, reason = 'New OP';
        if (options.freeOP === true || options.freeOP === 'true') {
            return { amount: 0, base: 0, surcharge: 0, reason: 'Doctor fee waived', startsEpisode: false };
        }
        if (previous && previous <= at && options.visitType !== 'New') {
            var days = Math.round((at - previous) / 86400000);
            if (days <= policy.fees.freeReviewDays) {
                fee = 0; reason = 'Review within 7 days';
            } else if (options.isPregnant) {
                fee = 100; reason = 'Pregnancy review';
            } else if (anchor && at <= addMonths(anchor, 1)) {
                fee = 100; reason = 'General review within 1 month';
            } else if (anchor && at <= addMonths(anchor, 3)) {
                fee = 200; reason = 'General review after 1 month';
            } else { fee = 300; reason = 'General review after 3 months'; }
        }
        var surcharge = options.phone ? policy.fees.phoneSurcharge : 0;
        return { amount: fee + surcharge, base: fee, surcharge: surcharge, reason: reason + (surcharge ? ' + phone OP' : ''), startsEpisode: !previous || options.visitType === 'New' || (!options.isPregnant && anchor && at > addMonths(anchor, 3)) };
    }
    root.HOSPITAL_POLICY = policy;
    root.calculateHospitalOPFee = calculateFee;
    if (typeof module !== 'undefined' && module.exports) module.exports = { policy: policy, calculateFee: calculateFee };
})(typeof window !== 'undefined' ? window : globalThis);
