import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  extractLegacyWebhook,
  formatProblem,
  migrateConfiguration,
  validateConfigDocument
} from "./config-schema.js";

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_PATH = path.join(ROOT, "config", "communities.json");
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    })
  : null;
let schemaReady;

function key() {
  const value = process.env.CONFIG_ENCRYPTION_KEY || "";
  const decoded = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (decoded.length !== 32) throw new Error("CONFIG_ENCRYPTION_KEY must encode 32 bytes.");
  return decoded;
}

export function encryptSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptSecret(value) {
  if (!value) return "";
  const [ivText, ciphertextText, tagText] = String(value).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

async function readLegacySeed() {
  return migrateLegacyConfiguration(
    JSON.parse(await fs.readFile(LEGACY_PATH, "utf8"))
  );
}

function migrateLegacyConfiguration(source) {
  const warnings = [];
  const webhook = extractLegacyWebhook(source);
  const document = migrateConfiguration(source, {
    onWarning: (warning) => warnings.push(warning)
  });
  return { document, webhook, warnings };
}

function reportMigrationWarnings(warnings) {
  for (const warning of warnings) {
    console.warn(`Configuration migration warning at ${warning.path}: ${warning.message}`);
  }
}

async function ensureSchema() {
  if (!pool) throw new Error("DATABASE_URL is required.");
  if (schemaReady) return schemaReady;
  schemaReady = initializeSchema().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function initializeSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS application_configuration (
      id integer PRIMARY KEY CHECK (id = 1),
      communities jsonb NOT NULL,
      webhook_ciphertext text NOT NULL DEFAULT '',
      revision bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT communities, webhook_ciphertext FROM application_configuration WHERE id = 1 FOR UPDATE"
    );
    if (!result.rowCount) {
      const seed = await readLegacySeed();
      reportMigrationWarnings(seed.warnings);
      await client.query(
        "INSERT INTO application_configuration (id, communities, webhook_ciphertext) VALUES (1, $1::jsonb, $2)",
        [JSON.stringify(seed.document), seed.webhook ? encryptSecret(seed.webhook) : ""]
      );
    } else {
      const current = result.rows[0].communities;
      if (current?.schemaVersion !== 2) {
        const migrated = migrateLegacyConfiguration(current);
        const existingCiphertext = result.rows[0].webhook_ciphertext;
        const existingWebhook = existingCiphertext
          ? decryptSecret(existingCiphertext)
          : "";
        if (migrated.webhook && existingWebhook && migrated.webhook !== existingWebhook) {
          throw new Error("Legacy configuration conflicts with the existing shared webhook; migrate manually.");
        }
        reportMigrationWarnings(migrated.warnings);
        if (migrated.webhook && !existingWebhook) {
          console.warn("Configuration migration moved a legacy shared webhook.");
        }
        await client.query(
          "UPDATE application_configuration SET communities = $1::jsonb, webhook_ciphertext = $2, revision = revision + 1, updated_at = now() WHERE id = 1",
          [
            JSON.stringify(migrated.document),
            existingCiphertext || (migrated.webhook ? encryptSecret(migrated.webhook) : "")
          ]
        );
      } else {
        const errors = validateConfigDocument(current);
        if (errors.length) throw new Error(`Stored configuration is invalid: ${errors.map(formatProblem).join(" ")}`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readConfiguration() {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT communities, webhook_ciphertext, revision, updated_at FROM application_configuration WHERE id = 1"
  );
  const row = rows[0];
  return {
    document: row.communities,
    schemaVersion: row.communities.schemaVersion,
    communities: row.communities.communities,
    templates: row.communities.templates,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    webhookConfigured: Boolean(row.webhook_ciphertext),
    webhook: row.webhook_ciphertext ? decryptSecret(row.webhook_ciphertext) : ""
  };
}

export async function writeConfiguration(document, expectedRevision) {
  const errors = validateConfigDocument(document);
  if (errors.length) return { ok: false, errors };
  await ensureSchema();
  const result = await pool.query(
    "UPDATE application_configuration SET communities = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = 1 AND revision = $2 RETURNING revision",
    [JSON.stringify(document), expectedRevision]
  );
  return result.rowCount
    ? { ok: true, revision: Number(result.rows[0].revision) }
    : { ok: false, conflict: true };
}

export async function writeWebhook(webhook, expectedRevision) {
  await ensureSchema();
  const result = await pool.query(
    "UPDATE application_configuration SET webhook_ciphertext = $1, revision = revision + 1, updated_at = now() WHERE id = 1 AND revision = $2 RETURNING revision",
    [webhook ? encryptSecret(webhook) : "", expectedRevision]
  );
  return result.rowCount
    ? { ok: true, revision: Number(result.rows[0].revision) }
    : { ok: false, conflict: true };
}

export async function closeConfigurationStore() {
  await pool?.end();
}
