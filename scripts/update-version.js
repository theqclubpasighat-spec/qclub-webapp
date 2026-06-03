import fs from "fs";
import path from "path";

const version = `qclub-${Date.now()}`;

const versionFilePath = path.resolve("public/version.json");

const versionData = {
  version,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(
  versionFilePath,
  JSON.stringify(versionData, null, 2)
);

console.log("Q Club version.json updated:", version);