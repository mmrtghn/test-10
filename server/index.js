import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMUNITY_CONFIG_PATH = path.join(ROOT_DIRECTORY, "config", "communities.json");

const PORT = numberFromEnvironment("PORT", 3000, 1, 65_535);
const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const CHALLENGE_MIN_RESPONSE_MS = 500;
const SESSION_MIN_SUBMISSION_MS = 4_000;
const MAX_CHALLENGE_ATTEMPTS = 5;
const GENERAL_RATE_WINDOW_MS = 15 * 60 * 1_000;
const GENERAL_RATE_MAX = 60;
const SUBMISSION_COOLDOWN_MS = 60 * 1_000;
const DUPLICATE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_UPLOAD_BYTES = 10_000_000;
const MAX_TOTAL_UPLOAD_BYTES = 48_000_000;
const MAX_ANIMAL_UPLOADS = 10;
const MAX_UPLOAD_FILES = MAX_ANIMAL_UPLOADS + 1;
const REQUIRED_STEP_KEYS = ["personal", "center", "story", "experience", "verification", "math", "date", "animals", "review", "success", "next"];
const SUPPORTED_UPLOAD_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const SUPPORTED_REVIEW_FIELDS = new Set(["name", "contact", "communityCenter", "experienceFile", "animalPictures"]);
const COMMUNITY_CONFIG = loadCommunityConfiguration();

const sessions = new Map();
const requestWindows = new Map();
const submissionCooldowns = new Map();
const duplicateApplications = new Map();

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);

app.use(securityHeaders);
app.use("/api", express.json({ limit: "32kb", strict: true }));
app.use("/api", enforceSameOrigin);
app.use("/api", rateLimit({ windowMs: GENERAL_RATE_WINDOW_MS, max: GENERAL_RATE_MAX }));

const upload = multer({
  storage: boundedMemoryStorage(MAX_TOTAL_UPLOAD_BYTES),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: MAX_UPLOAD_FILES,
    fields: 8,
    fieldSize: 24_000
  }
});

app.post("/api/session", (request, response) => {
  const communityId = cleanIdentifier(request.body?.communityId);
  const community = COMMUNITY_CONFIG[communityId];
  if (!community) return sendError(response, 404, "The selected community does not exist.");

  const sessionId = randomToken();
  const session = {
    id: sessionId,
    communityId,
    fingerprint: requestFingerprint(request),
    createdAt: Date.now(),
    lastAttemptAt: 0,
    totalAttempts: 0,
    completed: { math: false, date: false },
    manualReview: { mathAnswer: "", dateAnswer: "" },
    challenges: {},
    submitted: false,
    submissionInProgress: false
  };

  for (const type of ["math", "date"]) {
    session.challenges[type] = createChallenge(type);
  }
  sessions.set(sessionId, session);

  response.status(201).json({
    sessionId,
    challenges: publicChallenges(session.challenges)
  });
});

app.post("/api/challenge", (request, response) => {
  const session = getActiveSession(request, response);
  if (!session) return;

  const type = cleanIdentifier(request.body?.type);
  if (!['math', 'date'].includes(type)) return sendError(response, 400, "This challenge type cannot be refreshed.");
  if (session.completed[type]) return sendError(response, 409, "This verification is already complete.");

  const challenge = createChallenge(type);
  session.challenges[type] = challenge;
  response.status(201).json({ challenge: publicChallenge(challenge) });
});

app.post("/api/challenge/verify", (request, response) => {
  const session = getActiveSession(request, response);
  if (!session) return;

  const type = cleanIdentifier(request.body?.type);
  const challengeId = cleanIdentifier(request.body?.challengeId);
  const answer = String(request.body?.answer ?? "").trim();
  const challenge = session.challenges[type];

  if (!['math', 'date'].includes(type) || !challenge || challenge.id !== challengeId) {
    return sendError(response, 400, "This verification is no longer valid. Refresh it and try again.");
  }
  if (challenge.used || session.completed[type]) return sendError(response, 409, "This verification has already been used.");
  if (challenge.expiresAt <= Date.now()) {
    challenge.used = true;
    return sendError(response, 410, "This verification expired. Refresh it and try again.");
  }
  if (Date.now() - challenge.issuedAt < CHALLENGE_MIN_RESPONSE_MS) {
    return sendError(response, 429, "Please take a moment to read the verification, then try again.");
  }
  if (Date.now() - session.lastAttemptAt < 350) {
    return sendError(response, 429, "Please wait a moment before trying again.");
  }

  session.lastAttemptAt = Date.now();
  session.totalAttempts += 1;
  challenge.attempts += 1;
  if (session.totalAttempts > MAX_CHALLENGE_ATTEMPTS * 2 || challenge.attempts > MAX_CHALLENGE_ATTEMPTS) {
    challenge.used = true;
    return sendError(response, 429, "Too many verification attempts. Start a new application.");
  }

  const formatError = validateManualReviewAnswer(type, answer);
  if (formatError) return sendError(response, 400, formatError);

  challenge.used = true;
  session.completed[type] = true;
  session.manualReview[`${type}Answer`] = answer;
  response.json({ verified: true, type, review: "manual" });
});

app.post("/api/application", submissionRateLimit, requireApplicationSession, (request, response, next) => {
  upload.any()(request, response, (error) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === "LIMIT_TOTAL_FILE_SIZE"
        ? "The combined upload size is too large."
        : error.code === "LIMIT_FILE_SIZE"
          ? "One of the files is too large."
          : "The uploaded files could not be accepted.";
      return sendError(response, 400, message);
    }
    if (error) return next(error);
    next();
  });
}, async (request, response) => {
  const session = request.applicationSession;
  if (session.submitted || session.submissionInProgress) return sendError(response, 409, "This application has already been sent.");
  if (Date.now() - session.createdAt < SESSION_MIN_SUBMISSION_MS) {
    return sendError(response, 429, "Please review the application before sending it.");
  }

  const communityId = cleanIdentifier(request.body?.communityId);
  if (communityId !== session.communityId) return sendError(response, 400, "The application does not match this community.");
  if (!session.completed.math || !session.completed.date) {
    return sendError(response, 400, "Complete each verification before sending the application.");
  }

  const community = COMMUNITY_CONFIG[communityId];
  const parsedApplication = parseJsonField(request.body?.application);
  if (!parsedApplication) return sendError(response, 400, "The application data is not valid.");

  const validation = validateApplication(parsedApplication, community);
  if (!validation.valid) return response.status(400).json({ message: "Some application details need attention.", fields: validation.errors });

  const submittedMathAnswer = String(parsedApplication.verification.mathAnswer).trim();
  const submittedDateAnswer = String(parsedApplication.verification.dateAnswer).trim();
  if (submittedMathAnswer !== session.manualReview.mathAnswer || submittedDateAnswer !== session.manualReview.dateAnswer) {
    return sendError(response, 400, "The manual-review responses do not match the verified session.");
  }

  const uploadValidation = validateUploads(request.files ?? [], community);
  if (!uploadValidation.valid) return sendError(response, 400, uploadValidation.message);

  const normalizedEmail = parsedApplication.applicant.email.trim().toLowerCase();
  const duplicateKey = hashValue(`${communityId}|${normalizedEmail}`);
  const previousSubmission = duplicateApplications.get(duplicateKey);
  if (previousSubmission && previousSubmission.expiresAt > Date.now()) {
    return sendError(response, 409, "An application for this email was already received recently.");
  }

  const applicationId = createApplicationId(community.brandMark);
  session.submissionInProgress = true;
  const safeApplication = normalizeApplication(parsedApplication);

  try {
    await sendToDiscord({
      applicationId,
      community,
      application: safeApplication,
      files: uploadValidation.files,
      verification: {
        sessionCreatedAt: session.createdAt,
        submittedAt: Date.now(),
        mathAnswer: session.manualReview.mathAnswer,
        dateAnswer: session.manualReview.dateAnswer,
        mathReview: "Manual review",
        dateReview: "Manual review",
        animalUploadCount: uploadValidation.animalCount
      }
    });

    session.submissionInProgress = false;
    session.submitted = true;
    submissionCooldowns.set(`submit:${request.ip}`, Date.now());
    consumeSubmissionChallenges(session);
    duplicateApplications.set(duplicateKey, { applicationId, expiresAt: Date.now() + DUPLICATE_TTL_MS });
    response.status(201).json({ accepted: true, applicationId });
  } catch (error) {
    session.submissionInProgress = false;
    console.error("Discord delivery failed:", safeOperationalError(error));
    sendError(response, 503, "The application could not be delivered right now. Please try again later.");
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get(["/server/*", "/package.json", "/package-lock.json", "/.env*"], (_request, response) => {
  sendError(response, 404, "The requested file does not exist.");
});

app.use(express.static(ROOT_DIRECTORY, {
  dotfiles: "deny",
  etag: true,
  index: "index.html",
  maxAge: "1h",
  setHeaders(response, filePath) {
    if (filePath.endsWith(".html") || filePath.endsWith("communities.json")) {
      response.setHeader("Cache-Control", "no-cache");
    }
  }
}));

app.use("/api", (_request, response) => sendError(response, 404, "The requested service does not exist."));
app.use((error, _request, response, _next) => {
  console.error("Unexpected server error:", safeOperationalError(error));
  sendError(response, 500, "The server could not complete the request.");
});

const server = app.listen(PORT, () => {
  console.log(`Community application available at http://localhost:${PORT}/?community=community-a`);
});

server.on("error", (error) => {
  console.error("Server failed to start:", safeOperationalError(error));
  process.exitCode = 1;
});

const cleanupTimer = setInterval(cleanupStores, 5 * 60 * 1_000);
cleanupTimer.unref();

function createChallenge(type) {
  const base = {
    id: randomToken(),
    type,
    issuedAt: Date.now(),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    attempts: 0,
    used: false
  };

  if (type === "math") {
    return { ...base, display: "Enter any nine-digit number for manual review." };
  }
  if (type === "date") {
    return { ...base, display: "YYYY-MM-DD" };
  }
  throw new TypeError(`Unsupported challenge type: ${type}`);
}

function publicChallenges(challenges) {
  return Object.fromEntries(Object.entries(challenges).map(([type, challenge]) => [type, publicChallenge(challenge)]));
}

function publicChallenge(challenge) {
  return {
    id: challenge.id,
    type: challenge.type,
    display: challenge.display,
    expiresAt: new Date(challenge.expiresAt).toISOString()
  };
}

function validateManualReviewAnswer(type, answer) {
  if (type === "math") {
    return /^\d{9}$/.test(answer) ? "" : "Enter exactly nine digits for manual review.";
  }
  if (type === "date") {
    return isValidCalendarDate(answer) ? "" : "Enter a valid date for manual review.";
  }
  return "This manual-review response is not supported.";
}

function isValidCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function boundedMemoryStorage(maxTotalBytes) {
  return {
    _handleFile(request, file, callback) {
      const chunks = [];
      let size = 0;
      let rejected = false;
      let settled = false;
      request.totalUploadBytes = request.totalUploadBytes ?? 0;

      const settle = (error, result) => {
        if (settled) return;
        settled = true;
        callback(error, result);
      };

      file.stream.on("data", (chunk) => {
        request.totalUploadBytes += chunk.length;
        if (request.totalUploadBytes > maxTotalBytes) {
          rejected = true;
          chunks.length = 0;
          return;
        }
        if (!rejected) {
          chunks.push(chunk);
          size += chunk.length;
        }
      });
      file.stream.once("error", (error) => settle(error));
      file.stream.once("end", () => {
        if (rejected) {
          const error = new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname);
          error.code = "LIMIT_TOTAL_FILE_SIZE";
          settle(error);
          return;
        }
        settle(null, { buffer: Buffer.concat(chunks, size), size });
      });
    },
    _removeFile(_request, file, callback) {
      delete file.buffer;
      callback(null);
    }
  };
}

function requireApplicationSession(request, response, next) {
  const session = getActiveSession(request, response, request.get("x-application-session"));
  if (!session) return;
  request.applicationSession = session;
  next();
}

function getActiveSession(request, response, explicitSessionId) {
  const sessionId = cleanIdentifier(explicitSessionId ?? request.body?.sessionId);
  const session = sessions.get(sessionId);
  if (!session) {
    sendError(response, 401, "This application session is not valid. Start a new application.");
    return null;
  }
  if (session.fingerprint !== requestFingerprint(request)) {
    sendError(response, 401, "This application session could not be verified.");
    return null;
  }
  return session;
}

function validateApplication(payload, community) {
  const errors = {};
  const applicant = payload?.applicant ?? {};
  const center = payload?.communityCenter ?? {};
  const application = payload?.application ?? {};
  const agreements = payload?.agreements ?? {};
  const verification = payload?.verification ?? {};

  const email = String(applicant.email ?? "").trim();
  const phone = String(applicant.phone ?? "").trim();
  const zip = String(center.zip ?? "").trim();
  if (!validText(applicant.firstName, 1, 80)) errors.firstName = "Enter a valid first name.";
  if (!validText(applicant.lastName, 1, 80)) errors.lastName = "Enter a valid last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (!/^[+\d][\d\s().-]{6,29}$/.test(phone)) errors.phone = "Enter a valid phone number.";
  if (!validText(center.address, 3, 180)) errors.address = "Enter a valid address.";
  if (!validText(center.state, 2, 80)) errors.state = "Enter a valid state or province.";
  if (!/^[A-Za-z0-9][A-Za-z0-9\s-]{2,11}$/.test(zip)) errors.zip = "Enter a valid postal code.";
  if (!validText(application.letter, 20, 4_000)) errors.letter = "The letter must be between 20 and 4,000 characters.";
  if (!validText(application.volunteeringExperience, 20, 4_000)) errors.volunteeringExperience = "The experience must be between 20 and 4,000 characters.";
  if (validText(application.referral, 0, 500) === false) errors.referral = "The referral answer is too long.";
  const mathError = validateManualReviewAnswer("math", String(verification.mathAnswer ?? "").trim());
  const dateError = validateManualReviewAnswer("date", String(verification.dateAnswer ?? "").trim());
  if (mathError) errors.mathAnswer = mathError;
  if (dateError) errors.dateAnswer = dateError;

  for (const agreement of community.instructions.checkboxes) {
    if (agreement.required && agreements[agreement.id] !== true) errors[`agreement_${agreement.id}`] = "This agreement is required.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function validateUploads(files, community) {
  const expectedAnimalFields = new Set(community.animals.map((animal) => `animal_${animal.id}`));
  const allowedFields = new Set(["experience", ...expectedAnimalFields]);
  const seenFields = new Set();
  const normalizedFiles = [];
  let animalCount = 0;

  for (const file of files) {
    if (!allowedFields.has(file.fieldname) || seenFields.has(file.fieldname)) {
      return { valid: false, message: "The uploaded file list is not valid." };
    }
    seenFields.add(file.fieldname);
    const settings = file.fieldname === "experience" ? community.allowedUploads.application : community.allowedUploads.animal;
    const inspection = inspectFile(file, settings);
    if (!inspection.valid) return { valid: false, message: inspection.message };
    if (file.fieldname.startsWith("animal_")) animalCount += 1;
    normalizedFiles.push({
      field: file.fieldname,
      name: safeFilename(file.originalname),
      size: file.size,
      mime: inspection.detectedMime,
      buffer: file.buffer
    });
  }

  if (!seenFields.has("experience")) return { valid: false, message: "Attach an experience file before sending." };
  for (const field of expectedAnimalFields) {
    if (!seenFields.has(field)) return { valid: false, message: "Attach each requested animal picture." };
  }
  return { valid: true, files: normalizedFiles, animalCount };
}

function inspectFile(file, settings) {
  const name = safeFilename(file.originalname);
  if (!name || name.length > 120) return { valid: false, message: "Use a valid filename under 120 characters." };
  if (file.size <= 0 || file.size > Math.min(settings.maxBytes, MAX_UPLOAD_BYTES)) return { valid: false, message: "One of the files is empty or too large." };

  const extension = path.extname(name).toLowerCase();
  const acceptedExtensions = settings.accept.split(",").map((item) => item.trim().toLowerCase());
  if (!acceptedExtensions.includes(extension)) return { valid: false, message: "One of the file types is not allowed." };

  const detectedMime = detectMime(file.buffer);
  const extensionMimeMap = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  };
  if (!detectedMime || extensionMimeMap[extension] !== detectedMime) {
    return { valid: false, message: "A file’s contents do not match its extension." };
  }
  if (file.mimetype && file.mimetype !== detectedMime && !(detectedMime === "image/jpeg" && file.mimetype === "image/jpg")) {
    return { valid: false, message: "A file’s reported type does not match its contents." };
  }
  return { valid: true, detectedMime };
}

function detectMime(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function normalizeApplication(payload) {
  return {
    applicant: {
      firstName: cleanText(payload.applicant.firstName, 80),
      lastName: cleanText(payload.applicant.lastName, 80),
      email: cleanText(payload.applicant.email, 254),
      phone: cleanText(payload.applicant.phone, 30)
    },
    communityCenter: {
      address: cleanText(payload.communityCenter.address, 180),
      state: cleanText(payload.communityCenter.state, 80),
      zip: cleanText(payload.communityCenter.zip, 12)
    },
    application: {
      letter: cleanText(payload.application.letter, 4_000),
      volunteeringExperience: cleanText(payload.application.volunteeringExperience, 4_000),
      referral: cleanText(payload.application.referral, 500)
    }
  };
}

async function sendToDiscord({ applicationId, community, application, files, verification }) {
  const webhookUrl = String(community.webhook ?? "").trim();
  const payload = createDiscordPayload({ applicationId, community, application, files, verification });

  if (!webhookUrl) {
    console.log(`Accepted ${applicationId} for ${community.name}; no Discord webhook is configured.`);
    return;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error("Webhook configuration is invalid.");
  }
  if (parsedUrl.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(parsedUrl.hostname) || !parsedUrl.pathname.startsWith("/api/webhooks/")) {
    throw new Error("Webhook configuration is not an approved Discord URL.");
  }

  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  files.forEach((file, index) => {
    if (!Buffer.isBuffer(file.buffer)) throw new Error("Validated upload bytes are unavailable.");
    const filename = file.name || `upload-${index + 1}`;
    const blob = new Blob([file.buffer], { type: file.mime || "application/octet-stream" });
    form.append(`files[${index}]`, blob, filename);
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`);
}

function createDiscordPayload({ applicationId, community, application, files, verification }) {
  const { applicant, communityCenter, application: story } = application;
  const fileSummary = files.map((file) => `${file.field}: ${file.name} (${formatBytes(file.size)}, ${file.mime})`).join("\n");
  return {
    username: `${community.name} Applications`,
    allowed_mentions: { parse: [] },
    attachments: files.map((file, index) => ({
      id: index,
      filename: file.name || `upload-${index + 1}`
    })),
    embeds: [
      {
        title: `New application · ${applicationId}`,
        color: 0x14345b,
        fields: [
          discordField("Community", community.name, true),
          discordField("Applicant", [applicant.firstName, applicant.lastName].filter(Boolean).join(" "), true),
          discordField("Email", applicant.email, false),
          discordField("Phone", applicant.phone, false)
        ],
        timestamp: new Date().toISOString()
      },
      {
        title: "Community and application",
        color: 0x2268a9,
        fields: [
          discordField("Center", `${communityCenter.address}, ${communityCenter.state} ${communityCenter.zip}`, false),
          discordField("Letter", story.letter, false),
          discordField("Volunteering experience", story.volunteeringExperience, false),
          discordField("Referral", story.referral || "Not provided", false)
        ]
      },
      {
        title: "Verification",
        color: 0x2e9d62,
        fields: [
          discordField("Math response", verification.mathAnswer, true),
          discordField("Math review", verification.mathReview, true),
          discordField("Date response", verification.dateAnswer, true),
          discordField("Date review", verification.dateReview, true),
          discordField("Animal uploads", String(verification.animalUploadCount), true),
          discordField("Session age", `${Math.max(1, Math.round((verification.submittedAt - verification.sessionCreatedAt) / 1_000))} seconds`, true)
        ]
      },
      {
        title: "Uploaded files",
        color: 0xe9b96e,
        description: clipDiscord(fileSummary || "No files", 4_000)
      }
    ]
  };
}

function discordField(name, value, inline) {
  return { name: clipDiscord(name, 256), value: clipDiscord(value || "Not provided", 1_024), inline };
}

function clipDiscord(value, maximum) {
  const cleaned = cleanText(value, maximum * 2).replace(/@(everyone|here)/gi, "@$1​");
  return cleaned.length > maximum ? `${cleaned.slice(0, maximum - 1)}…` : cleaned;
}

function consumeSubmissionChallenges(session) {
  for (const challenge of Object.values(session.challenges)) challenge.used = true;
}

function securityHeaders(_request, response, next) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'"
  ].join("; "));
  next();
}

function enforceSameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (!origin) return next();
  try {
    if (new URL(origin).host !== request.get("host")) return sendError(response, 403, "Cross-site requests are not allowed.");
  } catch {
    return sendError(response, 403, "The request origin is not valid.");
  }
  next();
}

function rateLimit({ windowMs, max }) {
  return (request, response, next) => {
    const key = `general:${request.ip}`;
    const now = Date.now();
    const record = requestWindows.get(key);
    if (!record || record.resetAt <= now) {
      requestWindows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    response.setHeader("RateLimit-Limit", String(max));
    response.setHeader("RateLimit-Remaining", String(Math.max(0, max - record.count)));
    if (record.count > max) {
      response.setHeader("Retry-After", String(Math.ceil((record.resetAt - now) / 1_000)));
      return sendError(response, 429, "Too many requests. Please wait and try again.");
    }
    next();
  };
}

function submissionRateLimit(request, response, next) {
  const key = `submit:${request.ip}`;
  const previous = submissionCooldowns.get(key) ?? 0;
  const remaining = previous + SUBMISSION_COOLDOWN_MS - Date.now();
  if (remaining > 0) {
    response.setHeader("Retry-After", String(Math.ceil(remaining / 1_000)));
    return sendError(response, 429, "Please wait before sending another application.");
  }
  next();
}

function requestFingerprint(request) {
  return hashValue(`${request.ip}|${String(request.get("user-agent") ?? "").slice(0, 240)}`);
}

function cleanupStores() {
  const now = Date.now();
  for (const [key, record] of requestWindows) if (record.resetAt <= now) requestWindows.delete(key);
  for (const [key, submittedAt] of submissionCooldowns) if (submittedAt + SUBMISSION_COOLDOWN_MS <= now) submissionCooldowns.delete(key);
  for (const [key, record] of duplicateApplications) if (record.expiresAt <= now) duplicateApplications.delete(key);
}

function cleanIdentifier(value) {
  const text = String(value ?? "");
  return /^[A-Za-z0-9_-]{1,100}$/.test(text) ? text : "";
}

function cleanText(value, maximum) {
  return String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim().slice(0, maximum);
}

function validText(value, minimum, maximum) {
  const length = String(value ?? "").trim().length;
  return length >= minimum && length <= maximum;
}

function safeFilename(value) {
  return path.basename(String(value ?? "")).replace(/[\x00-\x1F\x7F]/g, "").trim();
}

function parseJsonField(value) {
  if (typeof value !== "string" || value.length > 24_000) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sendError(response, status, message) {
  return response.status(status).json({ message });
}

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomInteger(minimum, maximum) {
  return crypto.randomInt(minimum, maximum + 1);
}

function createApplicationId(mark = "APP") {
  const prefix = cleanIdentifier(mark).slice(0, 3).toUpperCase() || "APP";
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function formatBytes(bytes) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function loadCommunityConfiguration() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(COMMUNITY_CONFIG_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Community configuration could not be loaded: ${safeOperationalError(error)}`);
  }

  const communities = parsed?.communities;
  const errors = validateCommunityConfiguration(communities);
  if (errors.length) throw new Error(`Community configuration is invalid: ${errors.join(" ")}`);
  return communities;
}

function validateCommunityConfiguration(communities) {
  const errors = [];
  if (!communities || typeof communities !== "object" || Array.isArray(communities) || !Object.keys(communities).length) {
    return ["Add at least one community."];
  }

  for (const [communityId, community] of Object.entries(communities)) {
    const prefix = `Community “${communityId}”`;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(communityId)) errors.push(`${prefix} has an invalid ID.`);
    if (!community || typeof community !== "object" || Array.isArray(community)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!hasText(community.name)) errors.push(`${prefix} needs a name.`);
    if (!hasText(community.logo)) errors.push(`${prefix} needs a logo path.`);
    if (!hasText(community.brandMark)) errors.push(`${prefix} needs a brand mark.`);
    if (!hasText(community.footer)) errors.push(`${prefix} needs footer text.`);
    if (!validWebhook(community.webhook)) errors.push(`${prefix} webhook must be an approved HTTPS Discord webhook URL or blank.`);
    validateReviewFields(community.reviewFields, prefix, errors);

    for (const stepKey of REQUIRED_STEP_KEYS) {
      const copy = community.steps?.[stepKey];
      for (const field of ["eyebrow", "title", "description"]) {
        if (!hasText(copy?.[field])) errors.push(`${prefix} needs steps.${stepKey}.${field}.`);
      }
    }

    const formKeys = ["addressLabel", "addressHint", "letterLabel", "letterPlaceholder", "experienceLabel", "experiencePlaceholder", "referralLabel", "referralPlaceholder"];
    for (const key of formKeys) if (!hasText(community.form?.[key])) errors.push(`${prefix} needs form.${key}.`);

    if (!Array.isArray(community.instructions?.checklist) || !community.instructions.checklist.length || community.instructions.checklist.some((item) => !hasText(item))) {
      errors.push(`${prefix} needs at least one nonempty verification instruction.`);
    }
    const agreements = community.instructions?.checkboxes;
    if (!Array.isArray(agreements) || !agreements.length) {
      errors.push(`${prefix} needs at least one agreement.`);
    } else {
      validateNamedRows(agreements, `${prefix} agreement`, errors, ["label"]);
    }

    for (const key of ["mathIntro", "mathHint", "dateIntro", "dateHint", "animalIntro"]) {
      if (!hasText(community.captcha?.[key])) errors.push(`${prefix} needs captcha.${key}.`);
    }
    if (!Array.isArray(community.captcha?.animalBullets) || !community.captcha.animalBullets.length || community.captcha.animalBullets.some((item) => !hasText(item))) {
      errors.push(`${prefix} needs at least one nonempty animal instruction.`);
    }

    const animals = community.animals;
    if (!Array.isArray(animals) || animals.length < 1 || animals.length > MAX_ANIMAL_UPLOADS) {
      errors.push(`${prefix} needs between 1 and ${MAX_ANIMAL_UPLOADS} animal requests.`);
    } else {
      validateNamedRows(animals, `${prefix} animal`, errors, ["name", "title"]);
    }

    const applicationMax = validateUploadConfiguration(community.allowedUploads?.application, SUPPORTED_UPLOAD_EXTENSIONS, `${prefix} application upload`, errors);
    const animalExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    const animalMax = validateUploadConfiguration(community.allowedUploads?.animal, animalExtensions, `${prefix} animal upload`, errors);
    if (Number.isInteger(applicationMax) && Number.isInteger(animalMax) && Array.isArray(animals)) {
      if (applicationMax + animals.length * animalMax > MAX_TOTAL_UPLOAD_BYTES) {
        errors.push(`${prefix} upload limits exceed the ${formatBytes(MAX_TOTAL_UPLOAD_BYTES)} combined limit.`);
      }
    }

    for (const key of ["continue", "next", "back", "complete", "remove"]) {
      if (!hasText(community.buttons?.[key])) errors.push(`${prefix} needs buttons.${key}.`);
    }
  }
  return errors;
}

function validateReviewFields(fields, prefix, errors) {
  if (!Array.isArray(fields) || !fields.length) {
    errors.push(`${prefix} needs at least one review field.`);
    return;
  }
  const ids = new Set();
  fields.forEach((field, index) => {
    const label = `${prefix} review field ${index + 1}`;
    if (!field || typeof field !== "object" || !SUPPORTED_REVIEW_FIELDS.has(field.id)) {
      errors.push(`${label} has an unsupported ID.`);
    } else if (ids.has(field.id)) {
      errors.push(`${label} has a duplicate ID.`);
    } else {
      ids.add(field.id);
    }
    if (!hasText(field?.label)) errors.push(`${label} needs a label.`);
    if (typeof field?.enabled !== "boolean") errors.push(`${label} enabled must be true or false.`);
  });
}

function validWebhook(value) {
  if (value == null || String(value).trim() === "") return true;
  try {
    const url = new URL(String(value).trim());
    return url.protocol === "https:"
      && ["discord.com", "discordapp.com"].includes(url.hostname)
      && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

function validateNamedRows(rows, label, errors, textKeys) {
  const ids = new Set();
  rows.forEach((row, index) => {
    const rowLabel = `${label} ${index + 1}`;
    if (!row || typeof row !== "object" || !/^[A-Za-z0-9_-]{1,100}$/.test(String(row.id ?? ""))) {
      errors.push(`${rowLabel} has an invalid ID.`);
    } else if (ids.has(row.id)) {
      errors.push(`${rowLabel} has a duplicate ID.`);
    } else {
      ids.add(row.id);
    }
    for (const key of textKeys) if (!hasText(row?.[key])) errors.push(`${rowLabel} needs ${key}.`);
  });
}

function validateUploadConfiguration(settings, allowedExtensions, label, errors) {
  if (!settings || typeof settings !== "object") {
    errors.push(`${label} settings are missing.`);
    return NaN;
  }
  const extensions = String(settings.accept ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!extensions.length || extensions.some((extension) => !allowedExtensions.has(extension))) {
    errors.push(`${label} extensions are invalid.`);
  }
  if (!hasText(settings.label)) errors.push(`${label} needs a label.`);
  const maximum = Number(settings.maxBytes);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_UPLOAD_BYTES) {
    errors.push(`${label} maximum must be from 1 to ${MAX_UPLOAD_BYTES} bytes.`);
    return NaN;
  }
  return maximum;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function numberFromEnvironment(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function safeOperationalError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown error";
}
