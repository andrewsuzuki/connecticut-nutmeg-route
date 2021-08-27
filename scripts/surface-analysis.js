// Config
// Assume path-like highways (path, footway) without surface info, and that aren't marked as a sidewalk, are unpaved
const ASSUME_PATH_LIKE_IS_UNPAVED = true;
// Collapse major certainly-paved highway types (primary, secondary, tertiary, etc) into 'major'
const COLLAPSE_MAJOR_HIGHWAY_TYPES = true;

// Notices
if (ASSUME_PATH_LIKE_IS_UNPAVED) {
  console.log(
    "Note: Path-like (path, footway, etc) segments without the surface= tag are ASSUMED UNPAVED"
  );
} else {
  console.log(
    "Note: Path-like (path, footway, etc) segments without the surface= tag are CONSIDERED INDETERMINATE"
  );
}

if (COLLAPSE_MAJOR_HIGHWAY_TYPES) {
  console.log(`Note: Collapsing major paved highway types into 'major'`);
}

// highway= values that are almost certainly paved
// (not including residential, unclassified, service, track, path, footway, etc)
const certainlyPavedHighwayValues = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
  "major", // special internal type that the other ones collapse into, see explanation above
];

const likelyUnpavedRoadHighwayValues = [
  "track",
  // 'service', // TODO maybe
];

const likelyPathLikeHighwayValues = [
  "path",
  "footway", // TODO maybe not...sidewalks don't count (since they often aren't tagged as such)
  "bridleway",
  "steps",
  "pedestrian", // a bit less path-like, but close enough
  // not including cycleway
];

// surface= values that are "unpaved"
const unpavedSurfaceValues = [
  "dirt",
  "compacted",
  "earth",
  "gravel",
  "ground",
  "unpaved",
  "fine_gravel",
  "pebblestone",
  "rock",
  "sand",
  "mud",
  "woodchips",
  "salt",
  "grass", // debatable
  // The following aren't exactly unpaved, but they are fun:
  "wood",
  "grass_paver",
  // Cobblestone / variations...probably disable these:
  "cobblestone",
  "sett",
  "unhewn_cobblestone",
  "paving_stones",
];

// smoothness= values that are bad, in a good way
// only used to warn if segment doesn't have surface tag
const goodBadSmoothnessValues = [
  "bad",
  "very_bad",
  "horrible",
  "very_horrible",
  "impassable",
];

// tracktype= values that are bad, in a good way
// only used to warn if segment doesn't have surface tag
const goodBadTracktypeValues = [
  "grade1", // supposed to be smooth, but in practice, often used for rougher tracks
  "grade2",
  "grade3",
  "grade4",
  "grade5",
];

// Get from brouter-web data table
function getRawSegmentsFromBrouterWeb() {
  const rows = document.getElementById("datatable").rows;
  if (!rows.length) {
    throw new Error("Data table sidebar must be open to grab segments");
  }
  const list = [];
  for (var i = 1; i < rows.length; i++) {
    const el = rows[i].children;
    list.push({
      Elevation: el[0].innerText,
      Distance: el[1].innerText,
      WayTags: el[7].innerText,
    });
  }
  return list;
}

function parseSegments(data) {
  return data
    .map((segment) => ({
      elevation: parseInt(segment.Elevation, 10),
      distance: parseInt(segment.Distance, 10),
      tags: Object.fromEntries(
        segment.WayTags.split(" ").map((kvString) => {
          const [k, v] = kvString.split("=");

          if (
            COLLAPSE_MAJOR_HIGHWAY_TYPES &&
            k === "highway" &&
            certainlyPavedHighwayValues.includes(v)
          ) {
            return ["highway", "major"];
          }

          return [k, v];
        })
      ),
      original: segment,
    }))
    .filter((segment) => {
      if (!segment.tags.highway) {
        if (segment.tags.route !== "ferry") {
          console.warn(
            "found segment without highway= tag (removed segment):",
            segment
          );
        }
        return false;
      }
      return true;
    });
}
exports.parseSegments = parseSegments;

function hasSmoothnessOrTracktypeButNoSurface(tags) {
  const { surface, smoothness, tracktype } = tags;
  return (
    !surface &&
    ((smoothness && goodBadSmoothnessValues.includes(smoothness)) ||
      (tracktype && goodBadTracktypeValues.includes(tracktype)))
  );
}

function isExplicitlyUnpaved(tags) {
  const { surface } = tags;
  return surface && unpavedSurfaceValues.includes(surface);
}

function isExplicitlyPaved(tags) {
  const { surface } = tags;
  return surface && !unpavedSurfaceValues.includes(surface);
}

function isLikelyUnpavedRoad(tags) {
  const { highway } = tags;
  return (
    likelyUnpavedRoadHighwayValues.includes(highway) ||
    (isExplicitlyUnpaved(tags) &&
      !likelyPathLikeHighwayValues.includes(highway))
  );
}

function isPathLikeWithoutSurface(tags) {
  const { highway, surface } = tags;
  return !surface && likelyPathLikeHighwayValues.includes(highway);
}

function isTaggedSidewalk(tags) {
  const { highway, footway, sidewalk } = tags;
  return highway === "footway" && (footway === "sidewalk" || sidewalk);
}

function isLikelyUnpaved(tags) {
  const { highway, surface } = tags;
  return (
    isExplicitlyUnpaved(tags) ||
    (!surface && likelyUnpavedRoadHighwayValues.includes(highway)) ||
    (ASSUME_PATH_LIKE_IS_UNPAVED &&
      isPathLikeWithoutSurface(tags) &&
      !isTaggedSidewalk(tags))
  );
}

function isLikelyPaved(tags) {
  const { highway } = tags;
  return (
    isExplicitlyPaved(tags) ||
    certainlyPavedHighwayValues.includes(highway) ||
    isTaggedSidewalk(tags)
  );
}

// Group segments by unpaved/paved/indeterminate
function groupByUnpavedPaved(segments) {
  return segments.reduce(
    (acc, segment) => {
      const { tags, original } = segment;

      if (hasSmoothnessOrTracktypeButNoSurface(tags)) {
        console.warn(
          "Segment has smoothness or tracktype, but missing surface",
          original
        );
      }

      const type = isLikelyUnpaved(tags)
        ? "unpaved"
        : isLikelyPaved(tags)
        ? "paved"
        : "indeterminate";
      return { ...acc, [type]: [...acc[type], segment] };
    },
    { unpaved: [], paved: [], indeterminate: [] }
  );
}

function sumSegmentDistances(segments) {
  return segments.reduce((acc, { distance }) => acc + distance, 0);
}

const METERS_IN_A_MILE = 1609.344;
const FEET_IN_A_METER = 3.28084;

const intelligentRound = (x) => {
  const digits = x < 0.001 ? 4 : x < 0.01 ? 3 : x < 0.1 ? 2 : x < 3 ? 1 : 0;
  const multiplier = Math.pow(10, digits + 1);
  return Math.round(multiplier * x) / multiplier;
};

function mapValues(obj, f) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, f(v)]));
}

function keyedDistancesToSortedMaps(obj, mapKey) {
  return Object.entries(obj)
    .sort((a, b) => b[1].distance - a[1].distance)
    .map(([key, subObj]) => ({ [mapKey]: key, ...subObj }));
}

function distanceAndPercents(segments, of = {}) {
  const distanceMeters = sumSegmentDistances(segments);
  return {
    distance: intelligentRound(distanceMeters / METERS_IN_A_MILE),
    ...mapValues(of, (total) => intelligentRound(distanceMeters / total)),
  };
}

function groupByTag(segments, tag) {
  return segments.reduce((acc, segment) => {
    const value = segment.tags[tag] || "NONE";
    return { ...acc, [value]: [...(acc[value] || []), segment] };
  }, {});
}

function summary(segments, filteredAscendMeters = null) {
  // Get total distance
  const totalDistanceMeters = sumSegmentDistances(segments);

  const totalDistanceMiles = totalDistanceMeters / METERS_IN_A_MILE;

  const filteredAscendFeet = filteredAscendMeters * FEET_IN_A_METER;

  return {
    distanceUnit: "mile", // info

    distance: intelligentRound(totalDistanceMiles),

    ...(typeof filteredAscendMeters === "number"
      ? {
          filteredAscendUnit: "foot",
          filteredAscend: intelligentRound(filteredAscendFeet),
          filteredAscendPerUnitDistance: intelligentRound(
            filteredAscendFeet / totalDistanceMiles
          ),
        }
      : {}),

    unpavedPavedIndeterminate: mapValues(
      groupByUnpavedPaved(segments),
      (segments) =>
        distanceAndPercents(segments, { percentOfRoute: totalDistanceMeters })
    ),

    unpavedRoad: distanceAndPercents(
      segments.filter((segment) => isLikelyUnpavedRoad(segment.tags)),
      { percentOfRoute: totalDistanceMeters }
    ),

    disusedOrAbandoned: distanceAndPercents(
      segments.filter(
        ({ tags }) => tags.disused === "yes" || tags.abandoned === "yes"
      ),
      { percentOfRoute: totalDistanceMeters }
    ),

    wrongWay: distanceAndPercents(
      segments.filter(
        ({ tags }) =>
          tags.reversedirection === "yes" &&
          tags.oneway === "yes" &&
          tags.cycleway !== "opposite_lane" &&
          tags["cycleway:left"] !== "opposite_lane" &&
          tags["cycleway:right"] !== "opposite_lane"
      ),
      { percentOfRoute: totalDistanceMeters }
    ),

    byHighway: keyedDistancesToSortedMaps(
      mapValues(groupByTag(segments, "highway"), (highwaySegments) => ({
        ...distanceAndPercents(highwaySegments, {
          percentOfRoute: totalDistanceMeters,
        }),
        bySurface: keyedDistancesToSortedMaps(
          mapValues(groupByTag(highwaySegments, "surface"), (surfaceSegments) =>
            distanceAndPercents(surfaceSegments, {
              percentOfHighway: sumSegmentDistances(highwaySegments),
              percentOfRoute: totalDistanceMeters,
            })
          ),
          "surface"
        ),
      })),
      "highway"
    ),

    bySurface: keyedDistancesToSortedMaps(
      mapValues(groupByTag(segments, "surface"), (surfaceSegments) => ({
        ...distanceAndPercents(surfaceSegments, {
          percentOfRoute: totalDistanceMeters,
        }),
        byHighway: keyedDistancesToSortedMaps(
          mapValues(groupByTag(surfaceSegments, "highway"), (highwaySegments) =>
            distanceAndPercents(highwaySegments, {
              percentOfSurface: sumSegmentDistances(surfaceSegments),
              percentOfRoute: totalDistanceMeters,
            })
          ),
          "highway"
        ),
      })),
      "surface"
    ),
  };
}
exports.summary = summary;

function geojsonSegmentMessageRowsToJson(messages) {
  const [headers, ...rows] = messages;

  return rows.map((row) =>
    row.reduce((obj, value, i) => ({ ...obj, [headers[i]]: value }), {})
  );
}
exports.geojsonSegmentMessageRowsToJson = geojsonSegmentMessageRowsToJson;

// Run in node.js from file with file argument (geojson)
async function runf() {
  const { readFile } = require("fs/promises");

  const filename = process.argv[2];

  if (!filename) {
    throw new Error("Missing filename");
  }

  const gj = JSON.parse(await readFile(filename));

  const segments = parseSegments(
    geojsonSegmentMessageRowsToJson(gj.features[0].properties.messages)
  );
  console.dir(summary(segments), { depth: null });
}

// Run in browser console (brouter-web)
function runw() {
  const segments = parseSegments(getRawSegmentsFromBrouterWeb());
  console.dir(summary(segments), { depth: null });
}

if (this.window === this) {
  runw();
} else if (process.argv[1] === __filename) {
  runf();
}
