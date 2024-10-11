// HACKY, but format geojson files to put each message and coordinate on one line for cleaner diffing
// (basically how brouter 1.1 exported geojson)

const fs = require("node:fs/promises");

function format(obj) {
  const messages = obj.features[0].properties.messages;
  obj.features[0].properties.messages = "*MESSAGES*";
  const times = obj.features[0].properties.times;
  obj.features[0].properties.times = "*TIMES*";
  const coordinates = obj.features[0].geometry.coordinates;
  obj.features[0].geometry.coordinates = "*COORDINATES*";
  return JSON.stringify(obj, null, 2)
    .replace(
      `"*MESSAGES*"`,
      `[${messages
        .map(
          (message) =>
            `\n          [${message
              .map((entry) => JSON.stringify(entry))
              .join(", ")}]`
        )
        .join(",")}\n        ]`
    )
    .replace(`"*TIMES*"`, JSON.stringify(times))
    .replace(
      `"*COORDINATES*"`,
      `[${coordinates
        .map(
          (message) =>
            `\n          [${message
              .map((entry) => JSON.stringify(entry))
              .join(", ")}]`
        )
        .join(",")}\n        ]`
    );
}

async function formatKnownGeojson() {
  const files = [
    "../sections/section-1/section-1.geojson",
    "../sections/section-2/section-2.geojson",
    "../sections/section-3/section-3.geojson",
    "../sections/section-4/section-4.geojson",
    "../sections/section-5/section-5.geojson",
  ];
  for (const file of files) {
    const raw = await fs.readFile(file, { encoding: "utf8" });
    const formatted = format(JSON.parse(raw));
    if (raw !== formatted) {
      await fs.writeFile(file, formatted);
      console.log(`Formatted ${file}`);
    } else {
      console.log(`Already formatted ${file}`);
    }
  }
  console.log("Done formatting geojson");
}

if (process.argv[1] === __filename) {
  formatKnownGeojson();
}
