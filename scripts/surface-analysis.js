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
exports.certainlyPavedHighwayValues = certainlyPavedHighwayValues;

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

/**
 * Classify cycleways, and also determines bike access and if we're going the wrong way down a road.
 * This function provides dual-duty because determining these things is complicated by
 * contra-flow, bidirectional, etc cycleways that can be tagged a number of ways.
 * See array immediately below for possible return values.
 */
function cyclewayClassification(tags, drivesOn = "right") {
  // Possible return values, in order from best to worst
  // (used to determine the best option if there are multiple)
  const possibleReturnValues = [
    "dedicated", // protected cycle track, cyclestreet, pedestrian road, or shared busway
    "lane", // bike lane (in road)
    "sharrow", // sharrow (road)
    "none", // no cycleway, but still allowed to ride on road
    "discouraged", // discouraged or sidepath annotation
    "not-allowed", // bikes not allowed, but going the right way at least (NOTE based only on bicycle=, not access=)
    "wrong-way", // bikes not allowed, and going the wrong way down a street
  ];

  const {
    highway,
    cycleway,
    "cycleway:both": cyclewayBoth,
    "oneway:bicycle": onewayBicycle,
    bicycle,
  } = tags;
  const isReverseDirection = tags.reversedirection === "yes";
  const isOneway = tags.oneway === "yes";
  const isCyclestreet = tags.cyclestreet === "yes";
  const isAgainstOnewayMainRoad = isReverseDirection && isOneway;
  const isBicycleDiscouraged = ["use_sidepath", "discouraged"].includes(
    bicycle
  );
  const isBicycleNotAllowed = ["no", "dismount"].includes(bicycle);
  const hasCyclewayLeftOrRightValue = ["left", "right"].some(
    (side) => tags[`cycleway:${side}`]
  );
  const isAgainstOnewayMainRoadAndExplicitlyAllowed =
    isAgainstOnewayMainRoad && onewayBicycle === "no";
  const isPlainDirectionAllowed = // NOTE doesn't include cycleway:[side]:oneway or cycleway=opposite_[lane/track/share_busway] logic
    !isAgainstOnewayMainRoad || isAgainstOnewayMainRoadAndExplicitlyAllowed;

  const plainRoadDefault = isPlainDirectionAllowed ? "none" : "wrong-way";

  const defaultToPlainDirectionAndBicycle = (defaultValue) =>
    isPlainDirectionAllowed
      ? isBicycleNotAllowed
        ? "not-allowed"
        : isBicycleDiscouraged
        ? "discouraged"
        : defaultValue
      : "wrong-way";

  // Handle separately-tagged cycleways, which are always dedicated/protected

  if (highway === "cycleway") {
    if (isBicycleNotAllowed) {
      console.warn(
        `Found highway=cycleway with bicycle=${bicycle}, which doesn't make sense. Returning 'not-allowed'.`
      );
    }
    return defaultToPlainDirectionAndBicycle("dedicated");
  }

  // Handle ways without any of the cycleway* tags

  if (!cycleway && !cyclewayBoth && !hasCyclewayLeftOrRightValue) {
    if (isCyclestreet) {
      // Special case: cyclestreets
      return defaultToPlainDirectionAndBicycle("dedicated");
    } else if (likelyPathLikeHighwayValues.includes(highway)) {
      // Special case: path-like highway values (path, footway, pedestrian, bridleway, etc)
      return defaultToPlainDirectionAndBicycle("dedicated");
    } else if (tags.motor_vehicle === "no") {
      // Special case: motor vehicle not allowed
      return defaultToPlainDirectionAndBicycle("dedicated");
    } else {
      // No other relevant bike tags, so it's probably just a normal road
      return defaultToPlainDirectionAndBicycle("none");
    }
  }

  // [At this point, it definitely has one of the cycleway* tags]

  // Sanity check; ensure bicycle= makes sense
  if (isBicycleNotAllowed) {
    console.warn(
      `Found cycleway*=* with bicycle=${bicycle}, which doesn't make sense. Ignoring bicycle tag.`
    );
  }

  // Handle way with cycleway* tags

  const cyclewayValuesDedicatedGeneric = ["track", "share_busway"];
  const cyclewayValuesDedicatedOpposite = [
    "opposite_track",
    "opposite_share_busway",
  ];
  const cyclewayValuesLaneGeneric = ["lane", "crossing"];
  const cyclewayValuesLaneOpposite = ["opposite_lane"];
  const cyclewayValuesSharrowGeneric = ["shared_lane", "shared"];
  const cyclewayValuesSharrowOpposite = ["opposite"];
  const cyclewayValuesNo = [
    "no",
    "proposed",
    // TODO the rest should probably be classified as "discouraged", not "no"
    "separate",
    "sidepath",
    "sidewalk",
  ];

  // Group cycleway values based on whether they're generic (either bidirectional or
  // one-way/contra-flow using modern tagging) or "opposite" (deprecated contra-flow tagging)
  const cyclewayValuesYesGeneric = [
    ...cyclewayValuesDedicatedGeneric,
    ...cyclewayValuesLaneGeneric,
    ...cyclewayValuesSharrowGeneric,
  ];
  const cyclewayValuesYesOpposite = [
    ...cyclewayValuesDedicatedOpposite,
    ...cyclewayValuesLaneOpposite,
    ...cyclewayValuesSharrowOpposite,
  ];

  // Group cycleway values based on final cycleway classification
  const cyclewayValuesDedicated = [
    ...cyclewayValuesDedicatedGeneric,
    ...cyclewayValuesDedicatedOpposite,
  ];
  const cyclewayValuesLane = [
    ...cyclewayValuesLaneGeneric,
    ...cyclewayValuesLaneOpposite,
  ];
  const cyclewayValuesSharrow = [
    ...cyclewayValuesSharrowGeneric,
    ...cyclewayValuesSharrowOpposite,
  ];

  // Converts cycleway= value to the final cycleway classification
  const cyclewayValueClassification = (cyclewayValue) => {
    const classification = cyclewayValuesDedicated.includes(cyclewayValue)
      ? "dedicated"
      : cyclewayValuesLane.includes(cyclewayValue)
      ? "lane"
      : cyclewayValuesSharrow.includes(cyclewayValue)
      ? "sharrow"
      : cyclewayValuesNo.includes(cyclewayValue)
      ? "none"
      : null; // caught below
    if (!classification) {
      console.warn(
        `Unknown cycleway= value "${cyclewayValue}". Returning "none"`
      );
      return "none";
    }
    return classification;
  };

  if (
    cyclewayValuesYesGeneric.includes(cyclewayBoth) ||
    cyclewayValuesYesOpposite.includes(cyclewayBoth) // invalid, but include for sanity check and treat as normal
  ) {
    // Handle cycleway:both

    // Sanity check
    if (cycleway || hasCyclewayLeftOrRightValue) {
      console.warn(
        "Found cycleway:both with cycleway, cycleway:left, or cycleway:right (using cycleway:both only)"
      );
    }
    if (cyclewayValuesYesOpposite.includes(cyclewayBoth)) {
      console.warn(
        "Found cycleway:both with a value suggesting a contra-flow (opposite_*) on both sides, which seems unlikely"
      );
    }

    return cyclewayValueClassification(cyclewayBoth);
  } else if (cyclewayValuesYesGeneric.includes(cycleway)) {
    // Handle cycleway=, except for opposite* (contra-flow) values

    // Sanity check
    if (hasCyclewayLeftOrRightValue) {
      console.warn(
        "Found cycleway with cycleway:left or cycleway:right (using cycleway only)"
      );
    }

    if (isOneway) {
      // Road is oneway
      if (onewayBicycle === "no") {
        return cyclewayValueClassification(cycleway);
      } else if (!onewayBicycle || onewayBicycle === "yes") {
        return isReverseDirection
          ? "wrong-way"
          : cyclewayValueClassification(cycleway);
      }
    } else {
      // Road is bidirectional
      if (!onewayBicycle || onewayBicycle === "no") {
        return cyclewayValueClassification(cycleway);
      }
      // Don't handle case where it isn't oneway but onewayBicycle=yes or -1 (rare / undocumented)
    }

    console.warn(
      `Found cycleway=* with undocumented/ambiguous usage of oneway:bicycle. Returning "${plainRoadDefault}"`
    );
    return plainRoadDefault;
  } else if (cyclewayValuesYesOpposite.includes(cycleway)) {
    // Handle cycleway=opposite* (deprecated contra-flow tagging)

    // Sanity check; must be oneway=yes
    // Wiki says to put oneway:bicycle=no, but a contra-flow is heavily implied
    // by using the opposite* value, so omitting it seems allowable.
    if (!isOneway) {
      console.warn(
        `Found cycleway=opposite*, suggesting contra-flow, but without oneway=yes. Assuming it's a oneway.`
      );
    }

    if (isReverseDirection) {
      // We're in the contra-flow lane
      return cyclewayValueClassification(cycleway);
    }

    // NOTE It's still likely a decent street to ride on, having a contra-flow lane and all, but
    // there isn't any additional tagging to suggest it has sharrows or anything, unless it was
    // tagged using a mixture of cycleway= and cycleway:[side] tags,
    return defaultToPlainDirectionAndBicycle("none");
  } else if (hasCyclewayLeftOrRightValue) {
    // Handle cycleway:left and/or cycleway:right

    const SIDE_ONEWAY_WITH = "yes";
    const SIDE_ONEWAY_CONTRA_FLOW = "-1";
    const SIDE_ONEWAY_BOTH = "no";

    // Check if we're on one of the sides, and if so, what its value is
    const onCyclewaySideValue = (side) => {
      const value = tags[`cycleway:${side}`];
      if (!value) {
        return undefined;
      }
      // Get the oneway value for this side, if it was specified
      const explicitSideOneway = tags[`cycleway:${side}:oneway`];
      // Use the oneway value, or use the implied value based on what side the country
      // drives on and whether the main road is a oneway.
      const sideOneway =
        explicitSideOneway ||
        (!isOneway
          ? drivesOn === side
            ? SIDE_ONEWAY_WITH
            : SIDE_ONEWAY_CONTRA_FLOW
          : SIDE_ONEWAY_WITH); // NOTE ambiguous, see warning below.

      if (
        !explicitSideOneway &&
        isOneway &&
        drivesOn !== side &&
        !cyclewayValuesYesOpposite.includes(value)
      ) {
        // NOTE Could possibly use oneway:bicycle=no to hint at a contra-flow, but then that would also be
        // ambiguous if there's another lane on the other side (wouldn't know which is which), possibly with a proper :oneway tag.
        console.warn(
          `Found a oneway=yes cycleway:${side}=${value} without cycleway:${side}:oneway on the opposite side of the road the country usually drives on. ` +
            `It could be a contra-flow, but assuming it is NOT a contra-flow and that it is going in the same direction as the road.`
        );
      }

      // While using traditional opposite* (contra-flow) values isn't mentioned in the wiki with the cycleway:[side] keys,
      // it's still understandable at least if it doesn't have an explicit :oneway tag.
      // https://wiki.openstreetmap.org/wiki/Key:cycleway:right
      if (cyclewayValuesYesOpposite.includes(value)) {
        if (explicitSideOneway) {
          // If it DOES have a :oneway tag, then it's too ambiguous to understand (like a double negative)
          console.warn(
            `Found cycleway:${side}=${value}, which is already bad usage, but with a cycleway:${side}:oneway tag (ambiguous or double negative); ignoring`
          );
          return undefined;
        } else {
          // Otherwise, treat it the same as a cycleway=opposite*
          // Sanity check; the main road must be oneway
          if (!isOneway) {
            console.warn(
              `Found cycleway:${side}=${value}, suggesting contra-flow, but without oneway=yes. Assuming it's a oneway.`
            );
          }
          return isReverseDirection ? value : undefined;
        }
      }

      // Value is standard/generic (not a deprecated contra-flow tagging), so use
      // the [possibly implied] :oneway tags to determine if we're going in the same direction.
      return sideOneway === SIDE_ONEWAY_BOTH ||
        sideOneway ===
          (isReverseDirection ? SIDE_ONEWAY_CONTRA_FLOW : SIDE_ONEWAY_WITH)
        ? value
        : undefined;
    };

    const selectBestClassification = (classifications) => {
      return possibleReturnValues.find((classification) =>
        classifications.includes(classification)
      );
    };

    return selectBestClassification([
      ...["left", "right"]
        .map(onCyclewaySideValue)
        .filter((x) => x)
        .map(cyclewayValueClassification),
      ...[defaultToPlainDirectionAndBicycle("none")],
    ]);
  }

  console.warn(
    `Found unknown tag cycleway* value "${cycleway}", returning none`
  );
  return "none";
}

// Group segments by unpaved/paved/indeterminate
function groupByUnpavedPaved(segments) {
  return segments.reduce(
    (acc, segment) => {
      const { tags } = segment;

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

    noAccess: distanceAndPercents(
      segments.filter(
        ({ tags }) =>
          tags.access === "private" ||
          tags.access === "no" ||
          tags.bicycle === "no"
      ),
      { percentOfRoute: totalDistanceMeters }
    ),

    impassable: distanceAndPercents(
      segments.filter(({ tags }) => tags.smoothness === "impassable"),
      { percentOfRoute: totalDistanceMeters }
    ),

    byBikeClassification: keyedDistancesToSortedMaps(
      mapValues(
        segments.reduce((acc, segment) => {
          const value = cyclewayClassification(segment.tags);
          return { ...acc, [value]: [...(acc[value] || []), segment] };
        }, {}),
        (classificationSegments) =>
          distanceAndPercents(classificationSegments, {
            percentOfRoute: totalDistanceMeters,
          })
      ),
      "classification"
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
