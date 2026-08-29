const MAX_UPLOAD_BYTES = 10_000_000;
const MAX_TOTAL_UPLOAD_BYTES = 48_000_000;
const MAX_ANIMAL_UPLOADS = 10;
const REVIEW_FIELDS = new Set(["name", "contact", "communityCenter", "experienceFile", "animalPictures"]);
const STEP_KEYS = ["personal", "center", "story", "experience", "verification", "animals", "review", "success", "next"];

export function validateCommunityConfiguration(communities) {
  const errors = [];
  if (!communities || typeof communities !== "object" || Array.isArray(communities) || !Object.keys(communities).length) return ["Add at least one community."];
  for (const [id, c] of Object.entries(communities)) {
    const prefix = `Community “${id}”`;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) errors.push(`${prefix} has an invalid ID.`);
    if (!c || typeof c !== "object" || Array.isArray(c)) { errors.push(`${prefix} must be an object.`); continue; }
    for (const field of ["name", "logo", "brandMark", "footer"]) if (!text(c[field])) errors.push(`${prefix} needs ${field}.`);
    validateReview(c.reviewFields, prefix, errors);
    for (const step of STEP_KEYS) for (const field of ["eyebrow", "title", "description"]) if (!text(c.steps?.[step]?.[field])) errors.push(`${prefix} needs steps.${step}.${field}.`);
    for (const field of ["addressLabel", "addressHint", "letterLabel", "letterPlaceholder", "experienceLabel", "experiencePlaceholder", "referralLabel", "referralPlaceholder"]) if (!text(c.form?.[field])) errors.push(`${prefix} needs form.${field}.`);
    if (!Array.isArray(c.instructions?.checklist) || !c.instructions.checklist.length || c.instructions.checklist.some((x) => !text(x))) errors.push(`${prefix} needs instructions.`);
    if (!Array.isArray(c.instructions?.checkboxes) || !c.instructions.checkboxes.length) errors.push(`${prefix} needs agreements.`); else validateRows(c.instructions.checkboxes, `${prefix} agreement`, errors, ["label"]);
    for (const field of ["animalIntro"]) if (!text(c.captcha?.[field])) errors.push(`${prefix} needs captcha.${field}.`);
    if (!Array.isArray(c.captcha?.animalBullets) || !c.captcha.animalBullets.length) errors.push(`${prefix} needs animal instructions.`);
    if (!Array.isArray(c.animals) || c.animals.length < 1 || c.animals.length > MAX_ANIMAL_UPLOADS) errors.push(`${prefix} needs 1-${MAX_ANIMAL_UPLOADS} animals.`); else validateRows(c.animals, `${prefix} animal`, errors, ["name", "title"]);
    const appMax = validateUpload(c.allowedUploads?.application, new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]), `${prefix} application`, errors);
    const animalMax = validateUpload(c.allowedUploads?.animal, new Set([".png", ".jpg", ".jpeg", ".webp"]), `${prefix} animal`, errors);
    if (Number.isInteger(appMax) && Number.isInteger(animalMax) && appMax + c.animals.length * animalMax > MAX_TOTAL_UPLOAD_BYTES) errors.push(`${prefix} upload limits are too large.`);
    for (const field of ["continue", "next", "back", "complete", "remove"]) if (!text(c.buttons?.[field])) errors.push(`${prefix} needs buttons.${field}.`);
  }
  return errors;
}
function validateReview(fields, prefix, errors) { if (!Array.isArray(fields) || !fields.length) return errors.push(`${prefix} needs review fields.`); const ids = new Set(); fields.forEach((f, i) => { if (!f || !REVIEW_FIELDS.has(f.id) || ids.has(f.id)) errors.push(`${prefix} review field ${i + 1} has an invalid or duplicate ID.`); else ids.add(f.id); if (!text(f?.label) || typeof f.enabled !== "boolean") errors.push(`${prefix} review field ${i + 1} is incomplete.`); }); }
function validateRows(rows, label, errors, fields) { const ids = new Set(); rows.forEach((row, i) => { if (!row || !/^[A-Za-z0-9_-]{1,100}$/.test(String(row.id ?? "")) || ids.has(row.id)) errors.push(`${label} ${i + 1} has an invalid or duplicate ID.`); else ids.add(row.id); for (const f of fields) if (!text(row?.[f])) errors.push(`${label} ${i + 1} needs ${f}.`); }); }
function validateUpload(settings, allowed, label, errors) { if (!settings || typeof settings !== "object") { errors.push(`${label} upload settings are missing.`); return NaN; } const exts = String(settings.accept ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean); if (!exts.length || exts.some((x) => !allowed.has(x))) errors.push(`${label} upload extensions are invalid.`); if (!text(settings.label)) errors.push(`${label} upload needs a label.`); const max = Number(settings.maxBytes); if (!Number.isInteger(max) || max < 1 || max > MAX_UPLOAD_BYTES) { errors.push(`${label} upload size is invalid.`); return NaN; } return max; }
function text(value) { return typeof value === "string" && value.trim().length > 0; }
