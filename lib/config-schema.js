import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "./upload-policy.js";

export const CONFIG_SCHEMA_VERSION = 2;
export const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const LOGO_PATTERN = /^assets\/logos\/[A-Za-z0-9._-]+\.svg$/i;
export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
export const STEP_KEYS = ["personal", "center", "story", "experience", "verification", "animals", "review"];
export const COMPLETION_KEYS = ["success", "next"];
export const REVIEW_FIELD_IDS = ["name", "contact", "communityCenter", "experienceFile", "animalPictures"];
const TEMPLATE_KEYS = ["steps", "completion", "form", "instructions", "captcha", "animals", "allowedUploads", "reviewFields", "buttons"];
const COMMUNITY_KEYS = ["name", "logo", "brandMark", "footer", "theme", "templateId", "active"];
const FORM_KEYS = ["addressLabel", "addressHint", "letterLabel", "letterPlaceholder", "experienceLabel", "experiencePlaceholder", "referralLabel", "referralPlaceholder"];
const BUTTON_KEYS = ["continue", "next", "back", "complete", "remove"];
const UPLOAD_EXTENSIONS = {
  application: new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]),
  animal: new Set([".png", ".jpg", ".jpeg", ".webp"])
};
const MAX_ANIMALS = MAX_UPLOAD_FILES - 1;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor", "webhook"]);

export function validateConfigDocument(document) {
  const errors = [];
  if (!isObject(document)) return [problem("", "document.object", "Configuration must be an object.")];
  if (document.schemaVersion !== CONFIG_SCHEMA_VERSION) errors.push(problem("schemaVersion", "schema.version", `schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`));
  rejectUnknown(document, ["schemaVersion", "communities", "templates"], "", errors);
  if (!isObject(document.communities) || !Object.keys(document.communities).length) errors.push(problem("communities", "communities.required", "Add at least one community."));
  if (!isObject(document.templates) || !Object.keys(document.templates).length) errors.push(problem("templates", "templates.required", "Add at least one template."));
  if (isObject(document.communities)) {
    for (const [id, community] of Object.entries(document.communities)) validateCommunity(community, id, document.templates, errors);
  }
  if (isObject(document.templates)) {
    for (const [id, template] of Object.entries(document.templates)) validateTemplate(template, id, errors);
  }
  return errors;
}

export function validateTemplate(template, id = "template", errors = []) {
  const prefix = `templates.${id}`;
  if (!isId(id, TEMPLATE_ID_PATTERN)) errors.push(problem(prefix, "template.id", "Template ID is invalid."));
  if (!isObject(template)) return errors.push(problem(prefix, "template.object", "Template must be an object."));
  rejectUnknown(template, TEMPLATE_KEYS, prefix, errors);
  if (!isObject(template.steps)) errors.push(problem(`${prefix}.steps`, "steps.object", "Step copy is required."));
  else rejectUnknown(template.steps, STEP_KEYS, `${prefix}.steps`, errors);
  for (const key of STEP_KEYS) validateCopy(template.steps?.[key], `${prefix}.steps.${key}`, errors);
  if (!isObject(template.completion)) errors.push(problem(`${prefix}.completion`, "completion.object", "Completion copy is required."));
  else rejectUnknown(template.completion, COMPLETION_KEYS, `${prefix}.completion`, errors);
  for (const key of COMPLETION_KEYS) validateCopy(template.completion?.[key], `${prefix}.completion.${key}`, errors);
  if (!isObject(template.form)) errors.push(problem(`${prefix}.form`, "form.object", "Form copy is required."));
  for (const key of FORM_KEYS) validateText(template.form?.[key], `${prefix}.form.${key}`, errors);
  validateInstructions(template.instructions, prefix, errors);
  validateCaptcha(template.captcha, prefix, errors);
  validateRows(template.animals, `${prefix}.animals`, ["name", "title"], errors, 1, MAX_ANIMALS);
  validateUploads(template.allowedUploads, prefix, errors);
  validateReviewFields(template.reviewFields, prefix, errors);
  if (!isObject(template.buttons)) errors.push(problem(`${prefix}.buttons`, "buttons.object", "Button labels are required."));
  for (const key of BUTTON_KEYS) validateText(template.buttons?.[key], `${prefix}.buttons.${key}`, errors);
  return errors;
}

export function validateCommunity(community, id, templates, errors = []) {
  const prefix = `communities.${id}`;
  if (!isId(id, COMMUNITY_ID_PATTERN)) errors.push(problem(prefix, "community.id", "Community ID is invalid."));
  if (!isObject(community)) return errors.push(problem(prefix, "community.object", "Community must be an object."));
  rejectUnknown(community, COMMUNITY_KEYS, prefix, errors);
  for (const key of ["name", "logo", "brandMark", "footer", "templateId"]) validateText(community[key], `${prefix}.${key}`, errors);
  if (text(community.logo) && !LOGO_PATTERN.test(community.logo)) errors.push(problem(`${prefix}.logo`, "community.logo", "Logo must be a bundled SVG asset path."));
  if (text(community.brandMark) && !/^[A-Za-z0-9]{1,20}$/.test(community.brandMark)) errors.push(problem(`${prefix}.brandMark`, "community.brandMark", "Brand mark must contain only letters and numbers."));
  if (!isObject(community.theme)) errors.push(problem(`${prefix}.theme`, "community.theme", "Theme settings are required."));
  else { rejectUnknown(community.theme, ["accent"], `${prefix}.theme`, errors); if (!text(community.theme.accent) || !ACCENT_PATTERN.test(community.theme.accent)) errors.push(problem(`${prefix}.theme.accent`, "theme.accent", "Accent must be a six-digit hexadecimal color.")); }
  if (typeof community.active !== "boolean") errors.push(problem(`${prefix}.active`, "community.active", "Active must be a boolean."));
  if (text(community.templateId) && (!isObject(templates) || !Object.prototype.hasOwnProperty.call(templates, community.templateId))) errors.push(problem(`${prefix}.templateId`, "template.reference", "Choose an existing template."));
  return errors;
}

export function composeCommunity(document, id) {
  const community = document?.communities?.[id];
  if (!community || community.active === false) return null;
  const template = document.templates?.[community.templateId];
  if (!template) return null;
  return { schemaVersion: CONFIG_SCHEMA_VERSION, id, name: community.name, logo: community.logo, brandMark: community.brandMark, footer: community.footer, theme: structuredClone(community.theme), ...structuredClone(template) };
}

export function migrateConfiguration(input) {
  if (input?.schemaVersion === CONFIG_SCHEMA_VERSION) return structuredClone(input);
  const legacyCommunities = isObject(input?.communities) ? input.communities : isObject(input) ? input : null;
  if (!legacyCommunities) throw new Error("Legacy configuration must contain communities.");
  const communities = Object.create(null);
  const templates = Object.create(null);
  const usedTemplateIds = new Set();
  for (const [id, legacy] of Object.entries(legacyCommunities)) {
    if (!isObject(legacy)) throw new Error(`Community ${id} is invalid.`);
    let templateId = `${id}-template`;
    let suffix = 2;
    while (usedTemplateIds.has(templateId)) templateId = `${id}-template-${suffix++}`;
    usedTemplateIds.add(templateId);
    const template = pickTemplate(legacy);
    templates[templateId] = template;
    communities[id] = {
      name: legacy.name,
      logo: legacy.logo === "assets/logos/community.svg" ? "assets/logos/harborview.svg" : legacy.logo,
      brandMark: legacy.brandMark,
      footer: legacy.footer,
      theme: { accent: legacy.theme?.accent || "#14345B" },
      templateId,
      active: legacy.active !== false
    };
  }
  const result = { schemaVersion: CONFIG_SCHEMA_VERSION, communities, templates };
  const errors = validateConfigDocument(result);
  if (errors.length) throw new Error(`Migrated configuration is invalid: ${errors.map(formatProblem).join(" ")}`);
  return result;
}

export function createDefaultTemplate() {
  const copy = () => ({ eyebrow: "Application", title: "Tell us about yourself", description: "Share a few details with the community team." });
  return {
    steps: Object.fromEntries(STEP_KEYS.map((key) => [key, copy()])),
    completion: { success: copy(), next: copy() },
    form: Object.fromEntries(FORM_KEYS.map((key) => [key, key.includes("Placeholder") ? "Enter your answer" : key.includes("Hint") ? "Include enough detail for the team to find the right program." : "Your answer"])),
    instructions: { checklist: ["Review your information before continuing."], checkboxes: [{ id: "consent", label: "I confirm that the information I provided is accurate.", required: true }] },
    captcha: { animalIntro: "Upload a picture for each animal.", animalBullets: ["Use a clear, recent image."] },
    animals: [{ id: "animal", name: "the animal", title: "Upload an animal picture" }],
    allowedUploads: { application: { accept: ".pdf,.png,.jpg,.jpeg,.webp", label: "PDF or image", maxBytes: MAX_UPLOAD_BYTES }, animal: { accept: ".png,.jpg,.jpeg,.webp", label: "PNG, JPG, or WEBP image", maxBytes: MAX_UPLOAD_BYTES } },
    reviewFields: REVIEW_FIELD_IDS.map((id) => ({ id, label: id, enabled: true })),
    buttons: { continue: "Continue", next: "Next step", back: "Back", complete: "Complete application", remove: "Remove file" }
  };
}

function pickTemplate(legacy) {
  const template = {
    steps: {}, completion: {}, form: structuredClone(legacy.form), instructions: structuredClone(legacy.instructions), captcha: { animalIntro: legacy.captcha?.animalIntro, animalBullets: structuredClone(legacy.captcha?.animalBullets) }, animals: structuredClone(legacy.animals), allowedUploads: structuredClone(legacy.allowedUploads), reviewFields: structuredClone(legacy.reviewFields), buttons: structuredClone(legacy.buttons)
  };
  for (const key of STEP_KEYS) template.steps[key] = structuredClone(legacy.steps?.[key]);
  template.completion.success = structuredClone(legacy.steps?.success || legacy.success);
  template.completion.next = structuredClone(legacy.steps?.next || legacy.next);
  if (legacy.role && !template.steps.personal) template.steps.personal = structuredClone(legacy.role);
  if (legacy.secondaryRole && !template.steps.story) template.steps.story = structuredClone(legacy.secondaryRole);
  if (legacy.almostThere && !template.steps.verification) template.steps.verification = structuredClone(legacy.almostThere);
  return template;
}

function validateCopy(value, prefix, errors) { if (!isObject(value)) { errors.push(problem(prefix, "copy.object", "Copy is required.")); return; } rejectUnknown(value, ["eyebrow", "title", "description"], prefix, errors); for (const key of ["eyebrow", "title", "description"]) validateText(value[key], `${prefix}.${key}`, errors); }
function validateInstructions(value, prefix, errors) { if (!isObject(value)) return errors.push(problem(`${prefix}.instructions`, "instructions.object", "Instructions are required.")); rejectUnknown(value, ["checklist", "checkboxes"], `${prefix}.instructions`, errors); validateStringArray(value.checklist, `${prefix}.instructions.checklist`, errors, 1, 20); validateRows(value.checkboxes, `${prefix}.instructions.checkboxes`, ["label"], errors, 1, 20); for (const [i, row] of (value.checkboxes || []).entries()) if (row && typeof row.required !== "boolean") errors.push(problem(`${prefix}.instructions.checkboxes.${i}.required`, "agreement.required", "Required must be a boolean.")); }
function validateCaptcha(value, prefix, errors) { if (!isObject(value)) return errors.push(problem(`${prefix}.captcha`, "captcha.object", "Animal instructions are required.")); rejectUnknown(value, ["animalIntro", "animalBullets"], `${prefix}.captcha`, errors); validateText(value.animalIntro, `${prefix}.captcha.animalIntro`, errors); validateStringArray(value.animalBullets, `${prefix}.captcha.animalBullets`, errors, 1, 20); }
function validateReviewFields(value, prefix, errors) { if (!Array.isArray(value) || !value.length) return errors.push(problem(`${prefix}.reviewFields`, "review.required", "Add at least one review field.")); const ids = new Set(); for (const [i, row] of value.entries()) { const p = `${prefix}.reviewFields.${i}`; if (!isObject(row)) { errors.push(problem(p, "review.object", "Review field must be an object.")); continue; } if (!REVIEW_FIELD_IDS.includes(row.id) || ids.has(row.id)) errors.push(problem(p, "review.id", "Review field ID is invalid or duplicated.")); else ids.add(row.id); rejectUnknown(row, ["id", "label", "enabled"], p, errors); validateText(row.label, `${p}.label`, errors); if (typeof row.enabled !== "boolean") errors.push(problem(`${p}.enabled`, "review.enabled", "Enabled must be a boolean.")); } }
function validateRows(value, prefix, fields, errors, min, max) { if (!Array.isArray(value) || value.length < min || value.length > max) { errors.push(problem(prefix, "rows.count", `Add between ${min} and ${max} items.`)); return; } const ids = new Set(); for (const [i, row] of value.entries()) { const p = `${prefix}.${i}`; if (!isObject(row) || !isId(row.id, COMMUNITY_ID_PATTERN) || ids.has(row.id)) errors.push(problem(`${p}.id`, "rows.id", "ID is invalid or duplicated.")); else ids.add(row.id); if (isObject(row)) { rejectUnknown(row, ["id", ...fields, ...(prefix.endsWith("checkboxes") ? ["required"] : [])], p, errors); for (const field of fields) validateText(row[field], `${p}.${field}`, errors); } } }
function validateUploads(value, prefix, errors) { if (!isObject(value)) return errors.push(problem(`${prefix}.allowedUploads`, "uploads.object", "Upload settings are required.")); rejectUnknown(value, ["application", "animal"], `${prefix}.allowedUploads`, errors); for (const type of ["application", "animal"]) { const setting = value[type]; const p = `${prefix}.allowedUploads.${type}`; if (!isObject(setting)) { errors.push(problem(p, "uploads.missing", "Upload settings are required.")); continue; } rejectUnknown(setting, ["accept", "label", "maxBytes"], p, errors); const extensions = String(setting.accept || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); if (!extensions.length || extensions.some((x) => !UPLOAD_EXTENSIONS[type].has(x))) errors.push(problem(`${p}.accept`, "uploads.extensions", "One or more extensions are not allowed.")); validateText(setting.label, `${p}.label`, errors); if (!Number.isSafeInteger(setting.maxBytes) || setting.maxBytes < 1 || setting.maxBytes > MAX_UPLOAD_BYTES) errors.push(problem(`${p}.maxBytes`, "uploads.size", `Maximum size must be between 1 and ${MAX_UPLOAD_BYTES} bytes.`)); } }
function validateStringArray(value, prefix, errors, min, max) { if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => !text(item))) errors.push(problem(prefix, "array.strings", `Add between ${min} and ${max} non-empty items.`)); }
function validateText(value, prefix, errors) { if (!text(value)) errors.push(problem(prefix, "text.required", "This field is required.")); }
function rejectUnknown(value, allowed, prefix, errors) { for (const key of Object.keys(value)) if (!allowed.includes(key) || FORBIDDEN_KEYS.has(key)) errors.push(problem(prefix ? `${prefix}.${key}` : key, "key.unknown", "This field is not part of the canonical schema.")); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isId(value, pattern) { return typeof value === "string" && pattern.test(value); }
function text(value) { return typeof value === "string" && value.trim().length > 0; }
function problem(path, code, message) { return { path, code, message }; }
export function formatProblem(error) { return error?.path ? `${error.path}: ${error.message}` : String(error); }
