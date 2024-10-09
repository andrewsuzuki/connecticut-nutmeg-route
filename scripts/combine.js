// Check every section for required data, combine all sections into one gpx, export distance,
// selevation, surface analysis (for sections and entire route)

const fs = require("node:fs/promises");
const xmlbuilder2 = require("xmlbuilder2");
const {
  summary,
  parseSegments,
  geojsonSegmentMessageRowsToJson,
  certainlyPavedHighwayValues,
} = require("./surface-analysis");

const pathToSections = __dirname + "/../sections";

async function getDirectories(source) {
  return (await fs.readdir(source, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}

async function getSectionNames() {
  return (await getDirectories(pathToSections)).sort();
}

async function verifySectionIntegrity(sectionName) {
  const dirNames = await fs.readdir(pathToSections + "/" + sectionName);
  return ["geojson", "org"].every((ext) =>
    dirNames.includes(`${sectionName}.${ext}`)
  );
}

async function run() {
  const sectionNames = (await getSectionNames()).filter(
    (sectionName) => sectionName.match(/^section\-\d+$/) // don't include '-alt' sections
  );

  if (sectionNames.length < 1) {
    throw new Error("No sections found");
  }

  // Verify integrity
  for (let sectionName of sectionNames) {
    if (!(await verifySectionIntegrity(sectionName))) {
      throw new Error(`Section '${sectionName}' missing file`);
    }
  }

  // Read all sections
  const sections = await Promise.all(
    sectionNames.map(async (sectionName) => {
      const gj = JSON.parse(
        await fs.readFile(
          `${pathToSections}/${sectionName}/${sectionName}.geojson`
        )
      );
      const feature = gj.features[0];
      return {
        name: sectionName,
        segments: parseSegments(
          geojsonSegmentMessageRowsToJson(feature.properties.messages)
        ),
        points: feature.geometry.coordinates,
        filteredAscend: parseInt(feature.properties["filtered ascend"], 10),
      };
    })
  );

  // Write individual section analyses
  await Promise.all(
    sections.map(({ name, segments, filteredAscend }) => {
      fs.writeFile(
        `${pathToSections}/${name}/${name}-analysis.json`,
        JSON.stringify(summary(segments, filteredAscend), null, 2)
      );
    })
  );
  console.log("Wrote individual section analyses");

  // Combine segments and write route section analysis
  const allSegments = sections.reduce(
    (acc, section) => [...acc, ...section.segments],
    []
  );
  await fs.writeFile(
    `${__dirname}/../route-analysis.json`,
    JSON.stringify(
      summary(
        allSegments,
        sections.reduce((acc, section) => acc + section.filteredAscend, 0)
      ),
      null,
      2
    )
  );
  console.log("Wrote route section analysis");

  // Combine points and make route.gpx
  const allPoints = sections.reduce((acc, section) => {
    return [...acc, ...section.points];
  }, []);
  const gpxObj = {
    gpx: {
      "@xmlns": "http://www.topografix.com/GPX/1/1",
      "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      "@xsi:schemaLocation":
        "http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd",
      "@creator": "BRouter-1.6.1",
      "@version": "1.1",
      trk: {
        name: `CT Nutmeg Bikepacking Route ${new Date().toISOString()}`,
        trkseg: {
          trkpt: allPoints.map((point) => ({
            "@lon": `${point[0]}`,
            "@lat": `${point[1]}`,
            ele: `${point[2]}`,
          })),
        },
      },
    },
  };
  const doc = xmlbuilder2.create(gpxObj);
  doc.dec({ version: "1.0", encoding: "UTF-8", standalone: true });
  const xml = doc.end({ prettyPrint: true });
  await fs.writeFile(`${__dirname}/../route.gpx`, xml);
  console.log("Combined gpx and saved route.gpx (done)");

  // Export surface fixmes
  const insertAt = (str, sub, pos) =>
    `${str.slice(0, pos)}${sub}${str.slice(pos)}`;
  const surfaceFixmes = sections
    .reduce((acc, section) => {
      return [...acc, ...section.segments];
    }, [])
    .filter(
      (segment) =>
        !segment.tags.surface &&
        !certainlyPavedHighwayValues.includes(segment.tags.highway) &&
        !["track", "path"].includes(segment.tags.highway) && // might want to fix these later, but not a priority, as they're likely unpaved
        !["sidewalk", "crossing"].includes(segment.tags.footway)
    )
    .map(({ original, distance, tags }) => ({
      distance,
      tags,
      coordinateString: `${insertAt(original.Latitude, ".", 2)}, ${insertAt(
        original.Longitude,
        ".",
        3
      )}`,
    }));
  await fs.writeFile(
    `${__dirname}/../route-surface-fixmes.json`,
    JSON.stringify(surfaceFixmes, null, 2)
  );
  console.log("Found and saved surface fixmes (done)");
}

run();
