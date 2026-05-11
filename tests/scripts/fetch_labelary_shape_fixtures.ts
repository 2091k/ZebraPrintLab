import * as fs from "fs";
import * as path from "path";
import { shapeTestCases } from "../fixtures/shapeTestCases";

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/labelary_shape_images",
);

async function fetchLabelaryImage(zpl: string): Promise<Buffer> {
  // 8dpmm + 4×4 inches mirrors the barcode fixture infrastructure, so the
  // resulting 812×812 PNGs slot into the same comparison shape.
  const url = "http://api.labelary.com/v1/printers/8dpmm/labels/4x4/0/";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "image/png",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: zpl,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Labelary API error: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  console.log("Fetching Labelary shape fixtures...");
  for (const tc of shapeTestCases) {
    const imagePath = path.join(FIXTURES_DIR, tc.image_ref);

    if (fs.existsSync(imagePath)) {
      console.log(`⏩ Skipping ${tc.id} - image already exists.`);
      continue;
    }

    console.log(`Fetching ${tc.id}…`);
    console.log(`   ZPL: ${tc.zpl_input}`);
    try {
      const buf = await fetchLabelaryImage(tc.zpl_input);
      fs.writeFileSync(imagePath, buf);
      console.log(`✅ Saved ${tc.image_ref}`);
    } catch (e) {
      console.error(`❌ Failed ${tc.id}:`, e);
    }

    // Labelary throttles around 5 rps; stay well below.
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("🎉 Done.");
}

main().catch(console.error);
