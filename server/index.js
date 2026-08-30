import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { readConfiguration, writeCommunities, writeWebhook } from "../lib/config-store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = numberEnv("PORT", 3000, 1, 65535);
const MAX_FILE = 10_000_000;
const MAX_FILES = 11;
const MAX_TOTAL = 40_000_000;
const ADMIN_COOKIE = "master_admin";
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.use(securityHeaders);
app.use("/api", express.json({ limit: "64kb", strict: true }));
app.use("/api", enforceSameOrigin);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/config", async (req, res, next) => {
  try {
    const id = cleanIdentifier(req.query.community);
    const configuration = await readConfiguration();
    const community = configuration.communities[id];
    if (!community || community.active === false) return sendError(res, 404, "The selected community does not exist.");
    res.json({ community: publicCommunity(id, community) });
  } catch (error) { next(error); }
});

app.post("/api/admin/login", async (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || !(await verifyPassword(password))) return sendError(res, 401, "The password is not valid.");
  res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${encodeURIComponent(signCookie({ exp: Date.now() + 2 * 60 * 60 * 1000 }))}; Max-Age=7200; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ authenticated: true });
});
app.post("/api/admin/logout", (req, res) => { res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`); res.json({ authenticated: false }); });
app.get("/api/admin/session", requireAdmin, (_req, res) => res.json({ authenticated: true }));
app.get("/api/admin/config", requireAdmin, async (_req, res, next) => {
  try { const c = await readConfiguration(); const communities = Object.fromEntries(Object.entries(c.communities).map(([id, community]) => { const copy = structuredClone(community); delete copy.webhook; return [id, copy]; })); res.json({ communities, revision: c.revision, updatedAt: c.updatedAt, webhookConfigured: c.webhookConfigured }); } catch (error) { next(error); }
});
app.put("/api/admin/config", requireAdmin, async (req, res, next) => {
  try {
    const communities = Object.fromEntries(Object.entries(req.body?.communities || {}).map(([id, community]) => { const copy = structuredClone(community); delete copy.webhook; return [id, copy]; }));
    const revision = Number(req.body?.revision);
    const result = await writeCommunities(communities, revision);
    if (result.conflict) return sendError(res, 409, "This configuration changed elsewhere. Reload it before saving.");
    if (!result.ok) return res.status(400).json({ message: "The configuration is invalid.", fields: result.errors });
    res.json({ saved: true, revision: result.revision });
  } catch (error) { next(error); }
});
app.put("/api/admin/discord", requireAdmin, async (req, res, next) => {
  try {
    const webhook = String(req.body?.webhook ?? "").trim();
    const revision = Number(req.body?.revision);
    if (webhook && !validWebhook(webhook)) return sendError(res, 400, "Enter an approved HTTPS Discord webhook URL.");
    const result = await writeWebhook(webhook, revision);
    if (result.conflict) return sendError(res, 409, "This configuration changed elsewhere. Reload it before saving.");
    res.json({ saved: true, revision: result.revision, webhookConfigured: Boolean(webhook) });
  } catch (error) { next(error); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: MAX_FILES, fields: 4, fieldSize: 32_000 } });
app.post("/api/application", (req, res, next) => upload.any()(req, res, (error) => { if (error instanceof multer.MulterError) { if (error.code === "LIMIT_FILE_SIZE") return sendError(res, 400, "One of the uploaded files is too large. Choose a file under 10 MB."); if (error.code === "LIMIT_FILE_COUNT") return sendError(res, 400, "Too many files were uploaded."); return sendError(res, 400, "The uploaded files could not be accepted."); } if (error) return next(error); next(); }), async (req, res, next) => {
  try {
    const configuration = await readConfiguration();
    const communityId = cleanIdentifier(req.body?.communityId);
    const community = configuration.communities[communityId];
    if (!community || community.active === false) return sendError(res, 404, "The selected community does not exist.");
    const payload = parseJson(req.body?.application);
    if (!payload) return sendError(res, 400, "The application data is not valid.");
    const validation = validateApplication(payload, community);
    if (!validation.valid) return res.status(400).json({ message: "Some application details need attention.", fields: validation.errors });
    const uploads = validateUploads(req.files || [], community);
    if (!uploads.valid) return sendError(res, 400, uploads.message);
    const applicationId = createApplicationId(community.brandMark);
    await sendToDiscord({ applicationId, communityId, community, application: normalizeApplication(payload), files: uploads.files, webhook: configuration.webhook });
    res.status(201).json({ accepted: true, applicationId });
  } catch (error) { console.error("Application delivery failed:", safeError(error)); sendError(res, 503, "The application could not be delivered right now. Please try again later."); }
});

app.use((req, res, next) => {
  if (/^\/(config|server|lib|migration)(\/|$)/.test(req.path) || /^\/(package(?:-lock)?\.json|\.env(?:\.|$))$/.test(req.path)) return sendError(res, 404, "The requested file does not exist.");
  next();
});
app.use(express.static(ROOT, { dotfiles: "deny", index: "index.html", etag: true, maxAge: "1h", setHeaders(res, file) { if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); } }));
app.use("/api", (_req, res) => sendError(res, 404, "The requested service does not exist."));
app.use((error, _req, res, _next) => { console.error("Unexpected server error:", safeError(error)); sendError(res, 500, "The server could not complete the request."); });

export default app;
export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => console.log(`Community application available at http://localhost:${PORT}/?community=community-a`));
}

function publicCommunity(id, community) { const copy = structuredClone(community); delete copy.webhook; delete copy.active; return { id, ...copy }; }
function parseCookies(value = "") { return Object.fromEntries(value.split(";").map((part) => part.trim().split("=")).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)])); }
function signCookie(data) { const body = Buffer.from(JSON.stringify(data)).toString("base64url"); return `${body}.${crypto.createHmac("sha256", requiredEnv("ADMIN_SESSION_SECRET")).update(body).digest("base64url")}`; }
function verifyCookie(value) { try { const [body, signature] = String(value).split("."); const expected = crypto.createHmac("sha256", requiredEnv("ADMIN_SESSION_SECRET")).update(body).digest("base64url"); if (!body || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false; return JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now(); } catch { return false; } }
function requireAdmin(req, res, next) { const cookie = parseCookies(req.get("cookie"))[ADMIN_COOKIE]; if (!cookie || !verifyCookie(cookie)) return sendError(res, 401, "Administrator authentication is required."); next(); }
async function verifyPassword(password) { try { const encoded = requiredEnv("MASTER_ADMIN_PASSWORD_HASH"); const [salt, stored] = encoded.split("$"); if (!salt || !stored) return false; const derived = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key.toString("hex")))); return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(stored, "hex")); } catch { return false; } }
function validateApplication(payload, community) { const errors = {}; const a = payload?.applicant || {}, c = payload?.communityCenter || {}, s = payload?.application || {}, agreements = payload?.agreements || {}; if (!validText(a.firstName, 1, 80)) errors.firstName = "Enter a valid first name."; if (!validText(a.lastName, 1, 80)) errors.lastName = "Enter a valid last name."; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(a.email || "").trim())) errors.email = "Enter a valid email address."; if (!/^[+\d][\d\s().-]{6,29}$/.test(String(a.phone || "").trim())) errors.phone = "Enter a valid phone number."; if (!validText(c.address, 3, 180)) errors.address = "Enter a valid address."; if (!validText(c.state, 2, 80)) errors.state = "Enter a valid state or province."; if (!/^[A-Za-z0-9][A-Za-z0-9\s-]{2,11}$/.test(String(c.zip || "").trim())) errors.zip = "Enter a valid postal code."; if (!validText(s.letter, 20, 4000)) errors.letter = "The letter must be between 20 and 4,000 characters."; if (!validText(s.volunteeringExperience, 20, 4000)) errors.volunteeringExperience = "The experience must be between 20 and 4,000 characters."; if (String(s.referral || "").length > 500) errors.referral = "The referral answer is too long."; for (const item of community.instructions.checkboxes) if (item.required && agreements[item.id] !== true) errors[`agreement_${item.id}`] = "This agreement is required."; return { valid: !Object.keys(errors).length, errors }; }
function validateUploads(files, community) { const expected = new Set(community.animals.map((a) => `animal_${a.id}`)); const allowed = new Set(["experience", ...expected]); const seen = new Set(); const output = []; for (const file of files) { if (!allowed.has(file.fieldname) || seen.has(file.fieldname)) return { valid: false, message: "The uploaded file list is not valid." }; seen.add(file.fieldname); const settings = file.fieldname === "experience" ? community.allowedUploads.application : community.allowedUploads.animal; const name = safeFilename(file.originalname); const ext = path.extname(name).toLowerCase(); const accepted = String(settings.accept).split(",").map((x) => x.trim().toLowerCase()); const mime = detectMime(file.buffer); const expectedMime = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext]; if (!name || name.length > 120 || file.size < 1 || file.size > Math.min(settings.maxBytes, MAX_FILE) || !accepted.includes(ext) || mime !== expectedMime || (file.mimetype && file.mimetype !== mime && !(mime === "image/jpeg" && file.mimetype === "image/jpg"))) return { valid: false, message: "One of the uploaded files is invalid." }; output.push({ field: file.fieldname, name, size: file.size, mime, buffer: file.buffer }); } if (!seen.has("experience") || [...expected].some((x) => !seen.has(x))) return { valid: false, message: "Attach all required files before sending." }; if (output.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL) return { valid: false, message: "The combined upload size is too large." }; return { valid: true, files: output }; }
function detectMime(b) { if (b?.subarray(0, 5).toString() === "%PDF-") return "application/pdf"; if (b?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png"; if (b?.[0] === 255 && b?.[1] === 216 && b?.[2] === 255) return "image/jpeg"; if (b?.subarray(0, 4).toString() === "RIFF" && b?.subarray(8, 12).toString() === "WEBP") return "image/webp"; return ""; }
function normalizeApplication(p) { return { applicant: Object.fromEntries([["firstName", 80], ["lastName", 80], ["email", 254], ["phone", 30]].map(([k, n]) => [k, cleanText(p.applicant?.[k], n)])), communityCenter: Object.fromEntries([["address", 180], ["state", 80], ["zip", 12]].map(([k, n]) => [k, cleanText(p.communityCenter?.[k], n)])), application: Object.fromEntries([["letter", 4000], ["volunteeringExperience", 4000], ["referral", 500]].map(([k, n]) => [k, cleanText(p.application?.[k], n)])) }; }
async function sendToDiscord({ applicationId, communityId, community, application, files, webhook }) { if (!webhook) { console.log(`Accepted ${applicationId} for ${communityId}; no Discord webhook is configured.`); return; } if (!validWebhook(webhook)) throw new Error("Invalid webhook configuration."); const { applicant, communityCenter, application: story } = application; const payload = { username: `${community.name} Applications`, allowed_mentions: { parse: [] }, attachments: files.map((f, i) => ({ id: i, filename: f.name })), embeds: [{ title: `New application · ${applicationId}`, color: 0x14345b, fields: [field("Community ID", communityId, true), field("Community", community.name, true), field("Applicant", `${applicant.firstName} ${applicant.lastName}`, true), field("Email", applicant.email, false), field("Phone", applicant.phone, false)] }, { title: "Community and application", color: 0x2268a9, fields: [field("Center", `${communityCenter.address}, ${communityCenter.state} ${communityCenter.zip}`, false), field("Letter", story.letter, false), field("Volunteering experience", story.volunteeringExperience, false), field("Referral", story.referral || "Not provided", false)] }, { title: "Uploaded files", color: 0xe9b96e, description: clip(files.map((f) => `${f.field}: ${f.name} (${f.size} bytes)`).join("\n"), 4000) }] }; const form = new FormData(); form.append("payload_json", JSON.stringify(payload)); files.forEach((f, i) => form.append(`files[${i}]`, new Blob([f.buffer], { type: f.mime }), f.name)); const response = await fetch(webhook, { method: "POST", body: form, signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`); }
function field(name, value, inline) { return { name: clip(name, 256), value: clip(value || "Not provided", 1024), inline }; }
function clip(value, max) { const clean = cleanText(value, max * 2).replace(/@(everyone|here)/gi, "@$1​"); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; }
function validWebhook(value) { try { const u = new URL(value); return u.protocol === "https:" && ["discord.com", "discordapp.com"].includes(u.hostname) && u.pathname.startsWith("/api/webhooks/"); } catch { return false; } }
function securityHeaders(_req, res, next) { res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "no-referrer"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()"); res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"); next(); }
function enforceSameOrigin(req, res, next) { const origin = req.get("origin"); if (!origin) return next(); try { if (new URL(origin).host !== req.get("host")) return sendError(res, 403, "Cross-site requests are not allowed."); } catch { return sendError(res, 403, "The request origin is not valid."); } next(); }
function cleanIdentifier(value) { const text = String(value ?? ""); return /^[A-Za-z0-9_-]{1,100}$/.test(text) ? text : ""; }
function cleanText(value, max) { return String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, max); }
function validText(value, min, max) { const n = String(value ?? "").trim().length; return n >= min && n <= max; }
function safeFilename(value) { return path.basename(String(value ?? "")).replace(/[\x00-\x1F\x7F]/g, "").trim(); }
function parseJson(value) { if (typeof value !== "string" || value.length > 32_000) return null; try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch { return null; } }
function createApplicationId(mark = "APP") { return `${cleanIdentifier(mark).slice(0, 3).toUpperCase() || "APP"}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }
function sendError(res, status, message) { return res.status(status).json({ message }); }
function numberEnv(name, fallback, min, max) { const n = Number(process.env[name] ?? fallback); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; }
function requiredEnv(name) { if (!process.env[name]) throw new Error(`${name} is required.`); return process.env[name]; }
function safeError(error) { return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error"; }
