// Check every section for required data, combine all sections into one gpx, export distance,
// selevation, surface analysis (for sections and entire route)

const { readdir, readFile, writeFile } = require("fs/promises");
const xml2js = require("xml2js");
const csv = require("csvtojson");
const { summary, parseSegments } = require("./surface-analysis");

const pathToSections = __dirname + "/../sections";

async function getDirectories(source) {
  return (await readdir(source, { withFileTypes: true }))
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
}

async function getSectionNames() {
  return (await getDirectories(pathToSections)).sort();
}

async function verifySectionIntegrity(sectionName) {
  const dirNames = await readdir(pathToSections + "/" + sectionName);
  return ["gpx", "csv", "org"].every((ext) =>
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
    sectionNames.map(async (sectionName) => ({
      name: sectionName,
      segments: parseSegments(
        await csv({ delimiter: "\t" }).fromFile(
          `${pathToSections}/${sectionName}/${sectionName}.csv`
        )
      ),
    }))
  );

  // Write individual section analyses
  await Promise.all(
    sections.map(({ name, segments }) => {
      writeFile(
        `${pathToSections}/${name}/${name}-analysis.json`,
        JSON.stringify(summary(segments), null, 2)
      );
    })
  );
  console.log("Wrote individual section analyses");

  // Combine segments and write route section analysis
  const allSegments = sections.reduce(
    (acc, section) => [...acc, ...section.segments],
    []
  );
  await writeFile(
    `${__dirname}/../route-analysis.json`,
    JSON.stringify(summary(allSegments), null, 2)
  );
  console.log("Wrote route section analysis");

  // Combine gpx
  const parser = new xml2js.Parser();
  const builder = new xml2js.Builder();
  const parsedGpxSections = await Promise.all(
    sectionNames.map((sectionName) =>
      readFile(`${pathToSections}/${sectionName}/${sectionName}.gpx`).then(
        parser.parseStringPromise
      )
    )
  );
  const allTrackpoints = parsedGpxSections.reduce((acc, section) => {
    return [...acc, ...section.gpx.trk[0].trkseg[0].trkpt];
  }, []);
  const gpxObj = parsedGpxSections[0];
  gpxObj.gpx.trk[0].trkseg[0].trkpt = allTrackpoints;
  gpxObj.gpx.trk[0].name[0] = `CT Nutmeg Bikepacking Route ${
    new Date().toISOString().split("T")[0]
  }`;
  const xml = builder.buildObject(gpxObj);
  await writeFile(`${__dirname}/../route.gpx`, xml);
  console.log("Combined gpx and saved route.gpx (done)");
}

run();
