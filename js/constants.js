// Blind types whose ranges take no item colour in BlindIQ (Relate_Range_Colours is empty for every live range of
// the type, checked 11 Nov 2026): a double roller's fabrics are options, curtain tracks and bamboo blinds have none.
// Lines a year on them: Curtain Ripple 3,530, Double Roller Blind 2,533, Curtain Somfy 1,522, Curtain Glide 560,
// Bamboo Roll-Up 375, Bamboo Roman 91, Curtain Motion 13. Names are Blind IQ's own, in lower case. Before Nov 2026
// the list held 'element double roller' (the name until the Jan 2026 clean-up) and 'curtain glide curtain ripple'
// (two types run together), so 529 of the 570 Colour Alerts of 11 Oct - 10 Nov 2026 were on these products.
// Colourless ranges inside a type that does take colours (Roman Headrail, Roller Kit, the vertical and sliding
// headrails) are skipped by the colour check itself (runPostAIValidations in index.html).
export const BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK = [
    'double roller blind',
    'element double roller',
    'curtain glide',
    'curtain ripple',
    'curtain somfy',
    'curtain motion',
    'bamboo roll-up',
    'bamboo roman'
];

export const BLIND_TYPES_REQUIRING_CONTROL_VALIDATION = [
    'element roller',
    'roller system 40',
    'roller system 55',
    'element vison',
    'vision blind',
    'romashade',
    'outdoor channel x',
    'outdoor free hang',
    'outdoor zip x',
    'outdoor wire x',
    'outdoor widescreen'
];

export const BLIND_TYPES_REQUIRING_DUAL_CONTROL = [
    'element roller sys 40',
    'roller system 40',
    'roller system 55',
    'element double roller',
    'outdoor free hang',
    'element vision',
    'vision blind'
];

// Fields the order capturers treat as CRITICAL (Paul, 2026-08-05): mismatches or
// omissions here get the strongest highlighting, the top-of-report summary, and the
// end-of-run popup. Keys match the line-item field names used in renderReportTable.
export const CRITICAL_FIELDS = ['blindType', 'range', 'colour', 'qty', 'width', 'drop', 'control1', 'control2'];

export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
