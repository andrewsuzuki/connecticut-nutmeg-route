// Check every section for required data, combine all sections into one gpx, export distance,
// selevation, surface analysis (for sections and entire route)

const { readdirSync, readFileSync, writeFileSync } = require("fs");
const { readFile, writeFile } = require("fs/promises");
const xml2js = require("xml2js");
const { summary, parseSegments } = require("./surface-analysis");

const pathToSections = __dirname + "/../sections";

function getDirectories(source) {
  return readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}

function getSectionNames() {
  // TODO don't include -alt sections
  return getDirectories(pathToSections).sort();
}

function verifySectionIntegrity(sectionName) {
  const dirNames = readdirSync(pathToSections + "/" + sectionName);
  return ["gpx", "json", "org"].every((ext) =>
    dirNames.includes(`${sectionName}.${ext}`)
  );
}

function run() {
  const sectionNames = getSectionNames();

  if (sectionNames.length < 1) {
    throw new Error("No sections found");
  }

  // Verify integrity
  sectionNames.forEach((sectionName) => {
    if (!verifySectionIntegrity(sectionName)) {
      throw new Error(`Section '${sectionName}' missing file`);
    }
  });

  // Read all sections
  const sections = sectionNames.map((sectionName) => ({
    name: sectionName,
    segments: parseSegments(
      JSON.parse(
        readFileSync(
          pathToSections + "/" + sectionName + "/" + sectionName + ".json",
          "utf8"
        )
      )
    ),
  }));

  // Write individual section analyses
  sections.forEach(({ name, segments }) => {
    writeFileSync(
      `${pathToSections}/${name}/${name}-analysis.json`,
      JSON.stringify(summary(segments), null, 2)
    );
  });
  console.log("Wrote individual section analyses");

  // Combine segments and write route section analysis
  const allSegments = sections.reduce(
    (acc, section) => [...acc, ...section.segments],
    []
  );
  writeFileSync(
    `${__dirname}/../route-analysis.json`,
    JSON.stringify(summary(allSegments), null, 2)
  );
  console.log("Wrote route section analysis");

  // Combine gpx
  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder();
  Promise.all(
    sectionNames.map((sectionName) =>
      readFile(`${pathToSections}/${sectionName}/${sectionName}.gpx`).then(
        parser.parseStringPromise
      )
    )
  )
    .then((results) => {
      const allTrackpoints = results.reduce((acc, section) => {
        return [...acc, ...section.gpx.trk[0].trkseg[0].trkpt];
      }, []);
      const gpxObj = results[0];
      gpxObj.gpx.trk[0].trkseg[0].trkpt = allTrackpoints;
      gpxObj.gpx.trk[0].name[0] = `CT Nutmeg Bikepacking Route ${
        new Date().toISOString().split("T")[0]
      }`;
      const xml = builder.buildObject(gpxObj);
      return writeFile(`${__dirname}/../route.gpx`, xml);
    })
    .then(() => {
      console.log("Combined gpx and saved route.gpx (done)");
    });
}

run();
