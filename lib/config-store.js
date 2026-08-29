import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { validateCommunityConfiguration } from "./config-validation.js";

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY_PATH = path.join(ROOT, "config", "communities.json");
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false } }) : null;

function key() {
  const value = process.env.CONFIG_ENCRYPTION_KEY || "";
  const decoded = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
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
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

async function legacySeed() {
  const parsed = JSON.parse(await fs.readFile(LEGACY_PATH, "utf8"));
  const communities = structuredClone(parsed.communities);
  let webhook = "";
  for (const community of Object.values(communities)) {
    if (community.webhook) {
      if (webhook && webhook !== community.webhook) throw new Error("Legacy communities contain different webhooks; migrate manually.");
      webhook = community.webhook;
    }
    delete community.webhook;
  }
  const errors = validateCommunityConfiguration(communities);
  if (errors.length) throw new Error(`Community configuration is invalid: ${errors.join(" ")}`);
  return { communities, webhook };
}

async function ensureSchema() {
  if (!pool) throw new Error("DATABASE_URL is required.");
  await pool.query(`CREATE TABLE IF NOT EXISTS application_configuration (id integer PRIMARY KEY CHECK (id = 1), communities jsonb NOT NULL, webhook_ciphertext text NOT NULL DEFAULT '', revision bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now())`);
  const result = await pool.query("SELECT id FROM application_configuration WHERE id = 1");
  if (!result.rowCount) {
    const seed = await legacySeed();
    await pool.query("INSERT INTO application_configuration (id, communities, webhook_ciphertext) VALUES (1, $1::jsonb, $2)", [JSON.stringify(seed.communities), seed.webhook ? encryptSecret(seed.webhook) : ""]);
  }
}

export async function readConfiguration() {
  await ensureSchema();
  const { rows } = await pool.query("SELECT communities, webhook_ciphertext, revision, updated_at FROM application_configuration WHERE id = 1");
  const row = rows[0];
  return { communities: row.communities, revision: Number(row.revision), updatedAt: row.updated_at, webhookConfigured: Boolean(row.webhook_ciphertext), webhook: row.webhook_ciphertext ? decryptSecret(row.webhook_ciphertext) : "" };
}

export async function writeCommunities(communities, expectedRevision) {
  const errors = validateCommunityConfiguration(communities);
  if (errors.length) return { ok: false, errors };
  await ensureSchema();
  const result = await pool.query("UPDATE application_configuration SET communities = $1::jsonb, revision = revision + 1, updated_at = now() WHERE id = 1 AND revision = $2 RETURNING revision", [JSON.stringify(communities), expectedRevision]);
  return result.rowCount ? { ok: true, revision: Number(result.rows[0].revision) } : { ok: false, conflict: true };
}

export async function writeWebhook(webhook, expectedRevision) {
  await ensureSchema();
  const result = await pool.query("UPDATE application_configuration SET webhook_ciphertext = $1, revision = revision + 1, updated_at = now() WHERE id = 1 AND revision = $2 RETURNING revision", [webhook ? encryptSecret(webhook) : "", expectedRevision]);
  return result.rowCount ? { ok: true, revision: Number(result.rows[0].revision) } : { ok: false, conflict: true };
}

export async function closeConfigurationStore() { await pool?.end(); }
