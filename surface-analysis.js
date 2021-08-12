// Config
// Assume path-like highways (path, footway) without surface info, and that aren't marked as a sidewalk, are unpaved
const ASSUME_PATH_LIKE_IS_UNPAVED = true;
// Collapse major certainly-paved highway types (primary, secondary, tertiary, etc) into 'major'
const COLLAPSE_MAJOR_HIGHWAY_TYPES = true;

// highway= values that are almost certainly paved
// (not including residential, unclassified, service, track, path, footway, etc)
const certainlyPavedHighwayValues = [
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'motorway_link',
    'trunk_link',
    'primary_link',
    'secondary_link',
    'tertiary_link',
    'major', // special internal type that the other ones collapse into, see explanation above
];

const likelyUnpavedRoadHighwayValues = [
    'track',
    // 'service', // TODO maybe
];

const likelyPathLikeHighwayValues = [
    'path',
    'footway',
    'bridleway',
    'steps',
    'pedestrian', // a bit less path-like, but close enough
    // not including cycleway
];

// surface= values that are "unpaved"
const unpavedSurfaceValues = [
    'dirt',
    'compacted',
    'earth',
    'gravel',
    'ground',
    'unpaved',
    'fine_gravel',
    'pebblestone',
    'rock',
    'sand',
    'mud',
    'woodchips',
    'salt',
    'grass', // debatable
    // The following aren't exactly unpaved, but they are fun:
    'wood',
    'grass_paver',
    // Cobblestone / variations...probably disable these:
    'cobblestone',
    'sett',
    'unhewn_cobblestone',
    'paving_stones',
];

// smoothness= values that are bad, in a good way
// only used to warn if segment doesn't have surface tag
const goodBadSmoothnessValues = [
    'bad',
    'very_bad',
    'horrible',
    'very_horrible',
    'impassable',
];

// tracktype= values that are bad, in a good way
// only used to warn if segment doesn't have surface tag
const goodBadTracktypeValues = [
    'grade1', // supposed to be smooth, but in practice, often used for rougher tracks
    'grade2',
    'grade3',
    'grade4',
    'grade5',
];

// Get from data table
function getRawSegmentsFromBrouterWeb() {
    const rows = document.getElementById('datatable').rows;
    if (!rows.length) {
        throw new Error('Data table sidebar must be open to grab segments')
    }
    const list = [];
    for (var i = 1; i < rows.length; i++) {
        const el = rows[i].children;
        list.push({
            Distance: parseFloat(el[1].innerText),
            WayTags: el[7].innerText
        });
    }
    return list;
}

function parseSegments(data) {
    return data.map(seg => ({
        distance: seg.Distance,
        tags: Object.fromEntries(seg.WayTags.split(' ').map(kvString => {
            const [k, v] = kvString.split('=')

            if (COLLAPSE_MAJOR_HIGHWAY_TYPES && k === 'highway' && certainlyPavedHighwayValues.includes(v)) {
                return ['highway', 'major'];
            }

            return [k, v];
        })),
        original: seg,
    })).filter(seg => {
        if (!seg.tags.highway) {
            console.warn('found segment without highway= tag (removed segment):', seg)
            return false;
        }
        return true;
    });
}

function hasSmoothnessOrTracktypeButNoSurface(tags) {
    const { surface, smoothness, tracktype } = tags;
    return !surface && ((smoothness && goodBadSmoothnessValues.includes(smoothness)) || (tracktype && goodBadTracktypeValues.includes(tracktype)));
}

function isExplicitlyUnpaved(tags) {
    const { surface } = tags;
    return surface && unpavedSurfaceValues.includes(surface);
}

function isExplicitlyPaved(tags) {
    const { surface } = tags;
    return surface && !unpavedSurfaceValues.includes(surface);
}

// function isLikelyUnpavedRoad(tags) {
//     const { highway } = tags;
//     return likelyUnpavedRoadHighwayValues.includes(highway) || (isExplicitlyUnpaved(tags) && !likelyPathLikeHighwayValues.includes(highway));
// }

function isPathLikeWithoutSurface(tags) {
    const { highway, surface } = tags;
    return !surface && likelyPathLikeHighwayValues.includes(highway);
}

function isTaggedSidewalk(tags) {
    const { highway, footway, sidewalk } = tags;
    return highway === 'footway' && (footway === 'sidewalk' || sidewalk);
}

function isLikelyUnpaved(tags) {
    const { highway, surface } = tags;
    return isExplicitlyUnpaved(tags) ||
        (!surface && likelyUnpavedRoadHighwayValues.includes(highway)) ||
        (ASSUME_PATH_LIKE_IS_UNPAVED && isPathLikeWithoutSurface(tags) && !isTaggedSidewalk(tags));
}

function isLikelyPaved(tags) {
    const { highway } = tags;
    return isExplicitlyPaved(tags) || certainlyPavedHighwayValues.includes(highway) || isTaggedSidewalk(tags);
}

// Group segments by unpaved/paved/indeterminate
function groupByUnpavedPaved(segments) {
    return segments.reduce((acc, segment) => {
        const { tags, original } = segment

        if (hasSmoothnessOrTracktypeButNoSurface(tags)) {
            console.warn('Segment has smoothness or tracktype, but missing surface', original);
        }

        const type = isLikelyUnpaved(tags) ? 'unpaved' : isLikelyPaved(tags) ? 'paved' : 'indeterminate';
        return { ...acc, [type]: [...acc[type], segment] };
    }, { unpaved: [], paved: [], indeterminate: [] });
}

// Print results

function sumDistancesByKey(segs, key) {
    return segs.reduce((acc, seg) => {
        const valueMaybe = seg.tags[key] || 'NONE';
        return {
            ...acc,
            [valueMaybe]: (acc[valueMaybe] || 0) + seg.distance,
        };
    }, {});
}

function sumSegmentDistances(segs) {
    return segs.reduce((acc, { distance }) => acc + distance, 0);
}

const METERS_IN_A_MILE = 1609.344;

const intelligentRound = x => {
    const digits = (x < .001) ? 4 : (x < .01) ? 3 : (x < .1) ? 2 : (x < 3) ? 1 : 0;
    const multiplier = Math.pow(10, digits);
    return Math.round(multiplier * x) / multiplier;
};
const distanceString = distanceMeters => `${intelligentRound(distanceMeters / METERS_IN_A_MILE)}mi`;
const percentString = (distanceMeters, of, ofName) => `${intelligentRound(100 * distanceMeters / of)}% of ${ofName}`;
const distanceAndPercentString = (distanceMeters, of, ofName) => `${distanceString(distanceMeters)} (${percentString(distanceMeters, of, ofName)})`;

function printDistancesByKey(segs, key, of, ofName, totalDistanceMeters) {
    console.group(`Breakdown ${key}=`);
    const dbk = sumDistancesByKey(segs, key);
    const sorted = Object.entries(dbk).sort((a, b) => a[1] - b[1]).reverse();
    sorted.forEach(function([v, distance]) {
        console.log(v, `${distanceAndPercentString(distance, of, ofName)} (${percentString(distance, totalDistanceMeters, 'route')})`);
    });
    console.groupEnd();
}

function printSegmentSummary(label, segs, totalDistanceMeters) {
    const distanceMeters = sumSegmentDistances(segs);
    console.group(label);
    console.log(distanceAndPercentString(distanceMeters, totalDistanceMeters, 'route'));
    printDistancesByKey(segs, 'highway', distanceMeters, label, totalDistanceMeters);
    printDistancesByKey(segs, 'surface', distanceMeters, label, totalDistanceMeters);
    printDistancesByKey(segs, 'bicycle', distanceMeters, label, totalDistanceMeters);
    console.groupEnd();
}

function printTitle(text) {
    console.log(`%c${text}`, 'color: fuchsia; font-size: 2em; text-transform: uppercase;');
}

function run(segments) {
    // Notices
    if (ASSUME_PATH_LIKE_IS_UNPAVED) {
        console.log('Note: Path-like (path, footway, etc) segments without the surface= tag are ASSUMED UNPAVED');
    } else {
        console.log('Note: Path-like (path, footway, etc) segments without the surface= tag are CONSIDERED INDETERMINATE');
    }

    if (COLLAPSE_MAJOR_HIGHWAY_TYPES) {
        console.log(`Note: Collapsed major paved highway types into 'major'`);
    }

    console.log('Note: Surfaces found in this route:', segments.reduce((acc, { tags: { surface } }) => surface ? acc.add(surface) : acc, new Set()))

    // Get total distance
    const totalDistanceMeters = sumSegmentDistances(segments);

    // Group
    const { unpaved, paved, indeterminate } = groupByUnpavedPaved(segments);

    // Print
    printTitle('All');
    printSegmentSummary('All', segments, totalDistanceMeters);

    printTitle('By unpaved/paved/indeterminate (sums to 100%)');
    printSegmentSummary('Likely unpaved', unpaved, totalDistanceMeters);
    printSegmentSummary('Likely paved', paved, totalDistanceMeters);
    printSegmentSummary('Indeterminate', indeterminate, totalDistanceMeters);

    printTitle('Specific cases');
    printSegmentSummary('Path-like but unknown surface=', segments.filter(({ tags }) => isPathLikeWithoutSurface(tags) && !isTaggedSidewalk(tags)), totalDistanceMeters);
    printSegmentSummary('Path-like, but unknown bicycle=', segments.filter(({ tags }) => {
        const { highway, bicycle } = tags;
        return likelyPathLikeHighwayValues.includes(highway) && !bicycle;
    }), totalDistanceMeters);
    printSegmentSummary('Cycleway', segments.filter(({ tags }) => {
        const { highway } = tags;
        return highway === 'cycleway';
    }), totalDistanceMeters);
}

// Run in node.js from file
function runf() {
    const fs = require('fs');

    const filename = process.argv[2];

    if (!filename) {
        throw new Error('Missing filename');
    }

    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const segments = parseSegments(data);
    run(segments);
}

// Run in browser console (brouter-web)
function runw() {
    const segments = parseSegments(getRawSegmentsFromBrouterWeb());
    run(segments);
}

if (this.window === this) {
    runw();
} else {
    runf();
}
