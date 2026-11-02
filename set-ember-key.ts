import fs from "node:fs";
import crypto from "node:crypto";

// 1. Load .env.local or .env
for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}

async function main() {
  // 2. Import database without touching server-only libraries
  const { db } = await import("./src/db");
  const { restaurants } = await import("./src/db/schema");
  const { eq } = await import("drizzle-orm");

  // 3. Exact SHA-256 hash used by hashOwnerKey()
  const plainKey = "ember123";
  const hashed = crypto.createHash("sha256").update(plainKey).digest("hex");

  // 4. Update Ember & Oak
  const updated = await db
    .update(restaurants)
    .set({
      ownerKeyHash: hashed,
      integrationPasskeyHash: hashed,
    })
    .where(eq(restaurants.slug, "ember-and-oak"))
    .returning({ id: restaurants.id, name: restaurants.name });

  if (updated.length > 0) {
    console.log("\n==========================================");
    console.log(" SUCCESS!");
    console.log(` Restaurant: ${updated[0].name} (ID: ${updated[0].id})`);
    console.log(` Passkey / Owner Key: ember123`);
    console.log("==========================================\n");
  } else {
    console.log("Could not find restaurant with slug 'ember-and-oak'.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Error setting key:", err);
  process.exit(1);
});
