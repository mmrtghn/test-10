const FALLBACK_COMMUNITY = {
  name: "New Community",
  logo: "assets/logos/community.svg",
  brandMark: "C",
  webhook: "",
  reviewFields: [
    { id: "name", label: "Name", enabled: true },
    { id: "contact", label: "Contact", enabled: true },
    { id: "communityCenter", label: "Community center", enabled: true },
    { id: "experienceFile", label: "Experience file", enabled: true },
    { id: "animalPictures", label: "Animal pictures", enabled: true }
  ],
  steps: {
    personal: { eyebrow: "COMMUNITY VOLUNTEER", title: "Let’s get to know you", description: "Start with a few details so the community team knows who to contact." },
    center: { eyebrow: "Your community", title: "Where would you like to help?", description: "Tell us which community center or local program you’re applying to support." },
    story: { eyebrow: "YOUR STORY", title: "Tell the team what brings you here", description: "A thoughtful answer helps us understand how you’d like to contribute." },
    experience: { eyebrow: "Supporting file", title: "Add one file about your experience", description: "A résumé, certificate, portfolio page, or another helpful document is welcome." },
    verification: { eyebrow: "Almost there", title: "Let’s make sure you’re human", description: "A few quick checks help us keep applications safe and welcoming for everyone." },
    math: { eyebrow: "Secure verification", title: "Enter a nine-digit number", description: "Enter any nine-digit response. The community team will review it manually." },
    date: { eyebrow: "Secure verification", title: "Enter a date", description: "Enter any valid date. The community team will review the response manually; it is not compared with today’s date." },
    animals: { eyebrow: "A picture check", title: "Show us the animals", description: "Upload a picture that matches the animal we ask for." },
    review: { eyebrow: "Ready to send", title: "Review your application", description: "Take a quick look before sending your application to the community team." },
    success: { eyebrow: "Application received", title: "Application received", description: "Your application was received for manual review." },
    next: { eyebrow: "What’s next?", title: "What’s next?", description: "The community team will contact you if they need anything else." }
  },
  instructions: {
    checklist: ["Complete each verification carefully"],
    checkboxes: [
      { id: "member", label: "I agree to the community terms", required: true }
    ]
  },
  captcha: {
    mathIntro: "Enter any nine-digit number for manual review.",
    mathHint: "Use nine digits; no calculation is required.",
    dateIntro: "Enter any date for manual review.",
    dateHint: "Any valid past, present, or future date is accepted.",
    animalIntro: "Upload a picture that matches the animal we ask for.",
    animalBullets: ["Upload a clear picture", "Make sure the subject is easy to identify"]
  },
  footer: "Applications are reviewed by the community team.",
  form: {
    addressLabel: "Community center address",
    addressHint: "The location you’re applying to support",
    letterLabel: "Letter to the team",
    letterPlaceholder: "Tell us a little about yourself and why you’d like to help...",
    experienceLabel: "Volunteering experience",
    experiencePlaceholder: "Share any experience, skills, or interests that may be helpful...",
    referralLabel: "How did you hear about us?",
    referralPlaceholder: "Optional"
  },
  animals: [{ id: "animal", name: "an animal", title: "Upload the animal" }],
  allowedUploads: {
    application: { accept: ".pdf,.png,.jpg,.jpeg", label: "PDF or image", maxBytes: 8_000_000 },
    animal: { accept: ".jpg,.jpeg,.png,.webp", label: "PNG, JPG, or WEBP image", maxBytes: 10_000_000 }
  },
  buttons: {
    continue: "Continue",
    next: "Next step",
    back: "Back",
    complete: "Complete application",
    remove: "Remove file"
  }
};

const STEP_KEYS = ["personal", "center", "story", "experience", "verification", "math", "date", "animals", "review", "success", "next"];
const MAX_UPLOAD_BYTES = 10_000_000;
const MAX_TOTAL_UPLOAD_BYTES = 48_000_000;
const MAX_ANIMAL_UPLOADS = 10;
const APPLICATION_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const ANIMAL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REVIEW_FIELD_IDS = new Set(["name", "contact", "communityCenter", "experienceFile", "animalPictures"]);

const state = {
  communities: {},
  activeId: "",
  port: "3000",
  trustProxy: false
};

const editor = document.querySelector("#editor");
const list = document.querySelector("#community-list");
const message = document.querySelector("#message");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value == null ? "" : value[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((current, key) => current[key], object);
  target[last] = value;
}

function controlId(prefix, path) {
  return `${prefix}-${path}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

function field(label, path, value, options = {}) {
  const id = controlId("community-field", path);
  const labelMarkup = `<label for="${escapeHtml(id)}">${escapeHtml(label)}${options.hint ? `<small>${escapeHtml(options.hint)}</small>` : ""}</label>`;

  if (options.textarea) {
    const rows = options.rows ? ` rows="${escapeHtml(options.rows)}"` : "";
    return `<div class="field ${options.full ? "full" : ""}">${labelMarkup}<textarea id="${escapeHtml(id)}" data-community="${escapeHtml(state.activeId)}" data-bind="${escapeHtml(path)}"${rows}>${escapeHtml(value)}</textarea>${options.help ? `<div class="hint">${escapeHtml(options.help)}</div>` : ""}</div>`;
  }

  const type = options.type || "text";
  const step = options.step ? ` step="${escapeHtml(options.step)}"` : "";
  return `<div class="field ${options.full ? "full" : ""}">${labelMarkup}<input id="${escapeHtml(id)}" type="${escapeHtml(type)}" data-community="${escapeHtml(state.activeId)}" data-bind="${escapeHtml(path)}"${step} value="${escapeHtml(value)}">${options.help ? `<div class="hint">${escapeHtml(options.help)}</div>` : ""}</div>`;
}

function globalField(label, key, value, options = {}) {
  if (options.checkbox) {
    return `<label class="check-row"><input type="checkbox" data-global-bind="${escapeHtml(key)}" ${value ? "checked" : ""}>${escapeHtml(label)}</label>`;
  }

  const id = controlId("global-field", key);
  return `<div class="field"><label for="${escapeHtml(id)}">${escapeHtml(label)}${options.hint ? `<small>${escapeHtml(options.hint)}</small>` : ""}</label><input id="${escapeHtml(id)}" type="${escapeHtml(options.type || "text")}" data-global-bind="${escapeHtml(key)}" value="${escapeHtml(value)}"></div>`;
}

function sectionTitle(title) {
  return `<div class="section-label">${escapeHtml(title)}</div>`;
}

function repeatChecklist(items, path = "instructions.checklist", label = "Checklist item") {
  const rows = items.map((item, index) => `
    <div class="repeat-row">
      <div>${field(label, `${path}.${index}`, item)}</div>
      <button class="remove" type="button" data-list="${escapeHtml(path)}" data-index="${index}">Remove</button>
    </div>`).join("");

  return `<div class="repeat-list">${rows}</div><button class="button secondary small" type="button" data-add-list="${escapeHtml(path)}">Add ${escapeHtml(label.toLowerCase())}</button>`;
}

function repeatAgreements(items) {
  const rows = items.map((item, index) => `
    <div class="repeat-row">
      <div>${field("Agreement ID", `instructions.checkboxes.${index}.id`, item.id)}</div>
      <div>${field("Label", `instructions.checkboxes.${index}.label`, item.label)}</div>
      <label class="check-row"><input type="checkbox" data-community="${escapeHtml(state.activeId)}" data-bind="instructions.checkboxes.${index}.required" ${item.required ? "checked" : ""}>Required</label>
      <button class="remove" type="button" data-list="instructions.checkboxes" data-index="${index}">Remove</button>
    </div>`).join("");

  return `<div class="repeat-list">${rows}</div><button class="button secondary small" type="button" data-add-list="instructions.checkboxes">Add agreement</button>`;
}

function repeatAnimals(items) {
  const rows = items.map((item, index) => `
    <div class="repeat-row animal-row">
      <div>${field("ID", `animals.${index}.id`, item.id)}</div>
      <div>${field("Display name", `animals.${index}.name`, item.name)}</div>
      <div>${field("Upload title", `animals.${index}.title`, item.title)}</div>
      <button class="remove" type="button" data-list="animals" data-index="${index}">Remove</button>
    </div>`).join("");

  return `<div class="repeat-list">${rows}</div><button class="button secondary small" type="button" data-add-list="animals">Add animal request</button>`;
}

function renderCopyFields(stepKey, copy) {
  return `<div class="form-grid">
    ${field("Eyebrow", `steps.${stepKey}.eyebrow`, copy.eyebrow)}
    ${field("Title", `steps.${stepKey}.title`, copy.title)}
    ${field("Description", `steps.${stepKey}.description`, copy.description, { full: true, textarea: true })}
  </div>`;
}

function renderReviewFields(fields) {
  const rows = fields.map((item, index) => `
    <div class="repeat-row review-field-row">
      <div>${field("Field ID", `reviewFields.${index}.id`, item.id, { help: "Supported fields cannot be added or renamed." })}</div>
      <div>${field("Display label", `reviewFields.${index}.label`, item.label)}</div>
      <label class="check-row"><input type="checkbox" data-community="${escapeHtml(state.activeId)}" data-bind="reviewFields.${index}.enabled" ${item.enabled !== false ? "checked" : ""}>Show this row</label>
    </div>`).join("");

  return `<div class="repeat-list">${rows}</div><p class="hint">Choose which supported values applicants see before they submit. Labels are editable; field IDs are kept to the supported list for compatibility.</p>`;
}

function renderCommunity() {
  const community = state.communities[state.activeId];
  if (!community) {
    editor.innerHTML = '<div class="card"><p>No community selected.</p></div>';
    return;
  }

  const step = (key, fallback) => community.steps?.[key] || fallback;
  const copy = {
    personal: step("personal", FALLBACK_COMMUNITY.steps.personal),
    center: step("center", FALLBACK_COMMUNITY.steps.center),
    story: step("story", FALLBACK_COMMUNITY.steps.story),
    experience: step("experience", FALLBACK_COMMUNITY.steps.experience),
    verification: step("verification", FALLBACK_COMMUNITY.steps.verification),
    math: step("math", FALLBACK_COMMUNITY.steps.math),
    date: step("date", FALLBACK_COMMUNITY.steps.date),
    animals: step("animals", FALLBACK_COMMUNITY.steps.animals),
    review: step("review", FALLBACK_COMMUNITY.steps.review),
    success: step("success", FALLBACK_COMMUNITY.steps.success),
    next: step("next", FALLBACK_COMMUNITY.steps.next)
  };

  editor.innerHTML = `
    <div class="card">
      <div class="card-header"><div><h2>Server settings</h2><p>These values are written to the private .env output. Webhooks belong to each community below and are included in the JSON configuration.</p></div></div>
      <div class="form-grid">
        ${globalField("Server port", "port", state.port, { type: "number", hint: "Usually 3000." })}
        <div>${globalField("Trust reverse-proxy headers", "trustProxy", state.trustProxy, { checkbox: true })}<div class="hint">Enable only when a trusted reverse proxy overwrites headers.</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div><h2>Community identity</h2><p>Name, logo, short mark, and Discord delivery settings for this community.</p></div><button class="button danger small" type="button" id="remove-community">Remove community</button></div>
      <div class="form-grid">
        ${field("Community name", "name", community.name)}
        ${field("Brand mark", "brandMark", community.brandMark, { hint: "Short fallback mark" })}
        ${field("Discord webhook URL", "webhook", community.webhook, { full: true, hint: "Optional HTTPS Discord webhook for this community. It is stored in communities.json; protect that file and this builder." })}
        ${field("Logo path or URL", "logo", community.logo, { full: true, help: "Use a relative SVG or PNG path such as assets/logos/example.svg." })}
      </div>
    </div>

    <div class="card"><div class="card-header"><div><h2>Step 1 · Personal details</h2><p>Visible eyebrow, title, and description for the applicant contact screen.</p></div></div>${renderCopyFields("personal", copy.personal)}</div>

    <div class="card"><div class="card-header"><div><h2>Step 2 · Community center</h2><p>Visible copy and field wording for the location screen.</p></div></div>${renderCopyFields("center", copy.center)}${sectionTitle("Field wording")}<div class="form-grid">${field("Address label", "form.addressLabel", community.form.addressLabel)}${field("Address hint", "form.addressHint", community.form.addressHint)} </div></div>

    <div class="card"><div class="card-header"><div><h2>Step 3 · Applicant story</h2><p>Visible copy and labels for the written application details.</p></div></div>${renderCopyFields("story", copy.story)}${sectionTitle("Field wording")}<div class="form-grid">${field("Letter label", "form.letterLabel", community.form.letterLabel)}${field("Letter placeholder", "form.letterPlaceholder", community.form.letterPlaceholder)}${field("Experience label", "form.experienceLabel", community.form.experienceLabel)}${field("Experience placeholder", "form.experiencePlaceholder", community.form.experiencePlaceholder)}${field("Referral label", "form.referralLabel", community.form.referralLabel)}${field("Referral placeholder", "form.referralPlaceholder", community.form.referralPlaceholder)}</div></div>

    <div class="card"><div class="card-header"><div><h2>Step 4 · Supporting file</h2><p>Visible copy and accepted file settings for the experience upload.</p></div></div>${renderCopyFields("experience", copy.experience)}${sectionTitle("Upload settings")}<div class="form-grid three">${field("Accepted extensions", "allowedUploads.application.accept", community.allowedUploads.application.accept)}${field("File label", "allowedUploads.application.label", community.allowedUploads.application.label)}${field("Maximum bytes", "allowedUploads.application.maxBytes", community.allowedUploads.application.maxBytes, { type: "number", step: "1" })}</div></div>

    <div class="card"><div class="card-header"><div><h2>Step 5 · Verification introduction</h2><p>Visible copy, checklist, and agreement rows shown before the checks.</p></div></div>${renderCopyFields("verification", copy.verification)}${sectionTitle("Checklist")}${repeatChecklist(community.instructions.checklist)}${sectionTitle("Agreement checkboxes")}${repeatAgreements(community.instructions.checkboxes)}</div>

    <div class="card"><div class="card-header"><div><h2>Step 6 · Nine-digit manual review</h2><p>Any exactly nine-digit response is accepted for manual review; no calculation is required.</p></div></div>${renderCopyFields("math", copy.math)}<div class="form-grid">${field("Prompt", "captcha.mathIntro", community.captcha.mathIntro)}${field("Hint", "captcha.mathHint", community.captcha.mathHint)}</div></div>

    <div class="card"><div class="card-header"><div><h2>Step 7 · Date manual review</h2><p>Any valid calendar date is accepted and recorded for manual review.</p></div></div>${renderCopyFields("date", copy.date)}<div class="form-grid">${field("Prompt", "captcha.dateIntro", community.captcha.dateIntro)}${field("Hint", "captcha.dateHint", community.captcha.dateHint)}</div></div>

    <div class="card"><div class="card-header"><div><h2>Step 8 · Animal uploads</h2><p>Visible copy, animal requests, and required image settings.</p></div></div>${renderCopyFields("animals", copy.animals)}<div class="form-grid"><div class="field full">${field("Animal introduction", "captcha.animalIntro", community.captcha.animalIntro, { full: true, textarea: true })}</div></div>${sectionTitle("Animal instructions")}${repeatChecklist(community.captcha.animalBullets, "captcha.animalBullets", "Animal instruction")}${sectionTitle("Animal requests")}${repeatAnimals(community.animals)}${sectionTitle("Upload settings")}<div class="form-grid three">${field("Accepted extensions", "allowedUploads.animal.accept", community.allowedUploads.animal.accept)}${field("File label", "allowedUploads.animal.label", community.allowedUploads.animal.label)}${field("Maximum bytes", "allowedUploads.animal.maxBytes", community.allowedUploads.animal.maxBytes, { type: "number", step: "1" })}</div></div>

    <div class="card"><div class="card-header"><div><h2>Step 9 · Application review</h2><p>Visible copy and configurable rows for the final review screen before sending.</p></div></div>${renderCopyFields("review", copy.review)}${sectionTitle("Review fields")}${renderReviewFields(community.reviewFields)}</div>

    <div class="card"><div class="card-header"><div><h2>Completion screen</h2><p>Visible copy shown after the application is accepted.</p></div></div>${renderCopyFields("success", copy.success)}</div>

    <div class="card"><div class="card-header"><div><h2>Next-step screen</h2><p>Visible copy shown after the completion screen.</p></div></div>${renderCopyFields("next", copy.next)}${field("Footer text", "footer", community.footer, { full: true })}</div>

    <div class="card"><div class="card-header"><div><h2>Shared buttons</h2><p>Action labels used throughout the application.</p></div></div><div class="form-grid">${Object.entries(community.buttons).map(([key, value]) => field(key, `buttons.${key}`, value)).join("")}</div></div>`;
}

function renderList() {
  list.innerHTML = Object.entries(state.communities).map(([id, community]) => `
    <button type="button" class="community-tab ${id === state.activeId ? "active" : ""}" data-select-community="${escapeHtml(id)}">
      <span>${escapeHtml(community.name || id)}</span>
      <small>${escapeHtml(id)}</small>
    </button>`).join("");
}

function render() {
  renderList();
  renderCommunity();
}

function showMessage(text, kind = "success") {
  message.innerHTML = text ? `<div class="${kind}-box">${escapeHtml(text)}</div>` : "";
}

function validId(id) {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id);
}

function ensureShape(community) {
  const base = clone(FALLBACK_COMMUNITY);

  function merge(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        target[key] = target[key] || {};
        merge(target[key], value);
      } else if (value !== undefined) {
        target[key] = value;
      }
    });
  }

  merge(base, community);
  return base;
}

function validWebhook(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["discord.com", "discordapp.com"].includes(url.hostname) && url.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

function validateConfig() {
  const errors = [];
  const ids = Object.keys(state.communities);

  if (!ids.length) errors.push("Add at least one community.");

  const port = Number(state.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) errors.push("Enter a server port from 1 to 65535.");

  ids.forEach((id) => {
    const community = state.communities[id];
    const prefix = `Community “${id}”`;
    if (!validId(id)) errors.push(`${prefix} has an invalid ID.`);
    if (!hasText(community.name)) errors.push(`${prefix} needs a name.`);
    if (!hasText(community.logo)) errors.push(`${prefix} needs a logo path.`);
    if (!hasText(community.brandMark)) errors.push(`${prefix} needs a brand mark.`);
    if (!hasText(community.footer)) errors.push(`${prefix} needs footer text.`);
    if (!validWebhook(community.webhook.trim())) errors.push(`${prefix} webhook must be an approved HTTPS Discord webhook URL or blank.`);
    validateReviewFields(community.reviewFields, prefix, errors);

    for (const stepKey of STEP_KEYS) {
      for (const key of ["eyebrow", "title", "description"]) {
        if (!hasText(community.steps?.[stepKey]?.[key])) errors.push(`${prefix} needs ${stepKey} ${key}.`);
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
      validateRows(agreements, `${prefix} agreement`, ["label"], errors);
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
      validateRows(animals, `${prefix} animal`, ["name", "title"], errors);
    }

    const applicationMax = validateUploadSettings(community.allowedUploads?.application, APPLICATION_EXTENSIONS, `${prefix} application upload`, errors);
    const animalMax = validateUploadSettings(community.allowedUploads?.animal, ANIMAL_EXTENSIONS, `${prefix} animal upload`, errors);
    if (Number.isInteger(applicationMax) && Number.isInteger(animalMax) && Array.isArray(animals)) {
      if (applicationMax + animals.length * animalMax > MAX_TOTAL_UPLOAD_BYTES) {
        errors.push(`${prefix} upload limits exceed the 48 MB combined limit.`);
      }
    }

    for (const key of ["continue", "next", "back", "complete", "remove"]) {
      if (!hasText(community.buttons?.[key])) errors.push(`${prefix} needs buttons.${key}.`);
    }
  });

  return errors;
}

function validateRows(rows, label, textKeys, errors) {
  const ids = new Set();
  rows.forEach((row, index) => {
    const rowLabel = `${label} ${index + 1}`;
    const id = String(row?.id ?? "");
    if (!validId(id)) errors.push(`${rowLabel} has an invalid ID.`);
    else if (ids.has(id)) errors.push(`${rowLabel} has a duplicate ID.`);
    else ids.add(id);
    for (const key of textKeys) if (!hasText(row?.[key])) errors.push(`${rowLabel} needs ${key}.`);
  });
}

function validateReviewFields(fields, prefix, errors) {
  if (!Array.isArray(fields) || !fields.length) {
    errors.push(`${prefix} needs at least one review field.`);
    return;
  }
  const ids = new Set();
  fields.forEach((field, index) => {
    const label = `${prefix} review field ${index + 1}`;
    if (!field || typeof field !== "object" || !REVIEW_FIELD_IDS.has(field.id)) {
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

function validateUploadSettings(settings, allowedExtensions, label, errors) {
  const extensions = String(settings?.accept ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!extensions.length || extensions.some((extension) => !allowedExtensions.has(extension))) {
    errors.push(`${label} extensions are invalid.`);
  }
  if (!hasText(settings?.label)) errors.push(`${label} needs a label.`);
  const maximum = Number(settings?.maxBytes);
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_UPLOAD_BYTES) {
    errors.push(`${label} maximum must be from 1 to ${MAX_UPLOAD_BYTES} bytes.`);
    return NaN;
  }
  return maximum;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function publicCommunity(community) {
  return {
    name: community.name,
    logo: community.logo,
    brandMark: community.brandMark,
    webhook: community.webhook,
    reviewFields: clone(community.reviewFields),
    steps: clone(community.steps),
    instructions: clone(community.instructions),
    captcha: clone(community.captcha),
    footer: community.footer,
    form: clone(community.form),
    animals: clone(community.animals),
    allowedUploads: clone(community.allowedUploads),
    buttons: clone(community.buttons)
  };
}

function publicConfig() {
  const communities = {};
  Object.entries(state.communities).forEach(([id, community]) => {
    communities[id] = publicCommunity(community);
  });
  return { communities };
}

function envText() {
  const clean = (value) => String(value || "")
    .replaceAll(String.fromCharCode(13), "")
    .replaceAll(String.fromCharCode(10), "");

  return `PORT=${clean(state.port || "3000")}
TRUST_PROXY=${state.trustProxy ? "true" : "false"}
`;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function outputCard() {
  const errors = validateConfig();
  if (errors.length) {
    showMessage(errors.join(" "), "error");
    return;
  }

  const json = JSON.stringify(publicConfig(), null, 2);
  const env = envText();
  document.querySelector("#generated-output")?.remove();
  editor.insertAdjacentHTML("afterbegin", `
    <div class="card" id="generated-output">
      <div class="card-header">
        <div>
          <h2>Generated files</h2>
          <p>The JSON contains each community’s webhook and must be protected from public access. The environment text contains only server settings.</p>
        </div>
      </div>
      <div class="output-grid">
        <div class="output-box">
          <h3>config/communities.json</h3>
          <p>Replace the existing protected configuration with this output. It contains the per-community Discord webhooks.</p>
          <textarea readonly aria-label="Generated configuration JSON">${escapeHtml(json)}</textarea>
          <div class="actions">
            <button class="button secondary small" type="button" data-copy-output="json">Copy JSON</button>
            <button class="button small" type="button" data-download-output="json">Download JSON</button>
          </div>
        </div>
        <div class="output-box">
          <h3>.env</h3>
          <p>Copy this only to the server environment. Never commit or serve it.</p>
          <textarea readonly aria-label="Generated private environment">${escapeHtml(env)}</textarea>
          <div class="actions">
            <button class="button secondary small" type="button" data-copy-output="env">Copy .env</button>
            <button class="button small" type="button" data-download-output="env">Download .env</button>
          </div>
        </div>
      </div>
    </div>`);

  document.querySelector("#generated-output").scrollIntoView({ behavior: "smooth", block: "start" });
  showMessage("Files generated. Protect the JSON configuration and keep the .env output private.");
}

function controlValue(target) {
  if (target.type === "checkbox") return target.checked;
  if (target.type === "number") return Number(target.value);
  return target.value;
}

document.addEventListener("input", (event) => {
  const target = event.target;

  if (target.matches("[data-global-bind]")) {
    state[target.dataset.globalBind] = controlValue(target);
    return;
  }
  if (!target.matches("[data-bind]")) return;

  const community = state.communities[target.dataset.community];
  if (!community) return;
  setPath(community, target.dataset.bind, controlValue(target));
  if (target.dataset.bind === "name") renderList();
});

document.addEventListener("change", (event) => {
  const target = event.target;

  if (target.matches("[data-global-bind]")) {
    state[target.dataset.globalBind] = controlValue(target);
    return;
  }
  if (!target.matches("[data-bind]")) return;

  const community = state.communities[target.dataset.community];
  if (community) setPath(community, target.dataset.bind, controlValue(target));
});

document.addEventListener("click", async (event) => {
  const select = event.target.closest("[data-select-community]");
  if (select) {
    state.activeId = select.dataset.selectCommunity;
    render();
    return;
  }

  if (event.target.closest("#add-community")) {
    const input = document.querySelector("#new-community-id");
    const id = input.value.trim();
    if (!validId(id) || state.communities[id]) {
      showMessage("Use a unique community ID containing only letters, numbers, underscores, or hyphens.", "error");
      return;
    }

    state.communities[id] = clone(FALLBACK_COMMUNITY);
    state.communities[id].name = id;
    state.activeId = id;
    input.value = "";
    render();
    showMessage(`Added community “${id}”.`);
    return;
  }

  if (event.target.closest("#remove-community")) {
    const ids = Object.keys(state.communities);
    if (ids.length <= 1) {
      showMessage("Keep at least one community in the configuration.", "error");
      return;
    }

    delete state.communities[state.activeId];
    state.activeId = Object.keys(state.communities)[0];
    render();
    showMessage("Community removed.");
    return;
  }

  const add = event.target.closest("[data-add-list]");
  if (add) {
    const community = state.communities[state.activeId];
    const path = add.dataset.addList;
    const items = getPath(community, path);

    if (path === "animals") {
      if (items.length >= MAX_ANIMAL_UPLOADS) {
        showMessage(`A community can request up to ${MAX_ANIMAL_UPLOADS} animal uploads.`, "error");
        return;
      }
      items.push({ id: `animal-${items.length + 1}`, name: "an animal", title: "Upload the animal" });
    } else if (path === "instructions.checkboxes") {
      items.push({ id: `agreement-${items.length + 1}`, label: "I agree to this requirement", required: true });
    } else {
      items.push("New instruction");
    }
    render();
    return;
  }

  const remove = event.target.closest("[data-list]");
  if (remove) {
    const items = getPath(state.communities[state.activeId], remove.dataset.list);
    items.splice(Number(remove.dataset.index), 1);
    render();
    return;
  }

  if (event.target.closest("#generate-files")) {
    outputCard();
    return;
  }

  const copy = event.target.closest("[data-copy-output]");
  if (copy) {
    const selector = copy.dataset.copyOutput === "json"
      ? '#generated-output textarea[aria-label="Generated configuration JSON"]'
      : '#generated-output textarea[aria-label="Generated private environment"]';
    const box = document.querySelector(selector);

    try {
      await navigator.clipboard.writeText(box.value);
    } catch {
      box.select();
      document.execCommand("copy");
    }
    showMessage("Copied to the clipboard.");
    return;
  }

  const downloadButton = event.target.closest("[data-download-output]");
  if (downloadButton) {
    const isJson = downloadButton.dataset.downloadOutput === "json";
    const content = isJson ? JSON.stringify(publicConfig(), null, 2) : envText();
    download(isJson ? "communities.json" : ".env", content, isJson ? "application/json;charset=utf-8" : "text/plain;charset=utf-8");
  }
});

document.querySelector(".toolbar-actions").insertAdjacentHTML("beforeend", '<button class="button" id="generate-files" type="button">Generate files</button>');

async function load() {
  try {
    const response = await fetch("../config/communities.json", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Configuration could not be loaded.");

    const config = await response.json();
    state.communities = Object.fromEntries(
      Object.entries(config.communities || {}).map(([id, community]) => [id, ensureShape(community)])
    );
  } catch {
    state.communities = { "community-a": clone(FALLBACK_COMMUNITY) };
  }

  state.activeId = Object.keys(state.communities)[0];
  render();
}

void load();
