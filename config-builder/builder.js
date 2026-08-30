const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const STEPS = ["personal", "center", "story", "experience", "verification", "animals", "review"];
const COMPLETION = ["success", "next"];
const FORM_FIELDS = ["addressLabel", "addressHint", "letterLabel", "letterPlaceholder", "experienceLabel", "experiencePlaceholder", "referralLabel", "referralPlaceholder"];
const REVIEW_FIELDS = [
  ["name", "Name"],
  ["contact", "Contact"],
  ["communityCenter", "Community center"],
  ["experienceFile", "Experience file"],
  ["animalPictures", "Animal pictures"]
];
const $ = (id) => document.getElementById(id);
let state = {
  document: { schemaVersion: 2, communities: {}, templates: {} },
  savedDocument: { schemaVersion: 2, communities: {}, templates: {} },
  revision: 0,
  selectedCommunity: "",
  selectedTemplate: "",
  mode: "community",
  dirty: false,
  saving: false,
  webhookConfigured: false,
  updatedAt: ""
};

window.addEventListener("DOMContentLoaded", () => {
  $("login").addEventListener("click", login);
  $("logout").addEventListener("click", logout);
  $("add-community").addEventListener("click", addCommunity);
  $("add-template").addEventListener("click", addTemplate);
  $("save-config").addEventListener("click", saveConfiguration);
  $("discard-config").addEventListener("click", discardConfiguration);
  $("export-config").addEventListener("click", exportConfiguration);
  $("import-config").addEventListener("change", importConfiguration);
  $("save-webhook").addEventListener("click", saveWebhook);
  $("community-list").addEventListener("click", selectItem);
  $("template-list").addEventListener("click", selectItem);
  $("editor").addEventListener("click", editorClick);
  $("editor").addEventListener("input", editorInput);
  $("editor").addEventListener("change", editorInput);
  checkSession();
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload.message || "The request failed.");
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function checkSession() {
  try {
    await api("/api/admin/session");
    showAdmin();
    await load();
  } catch {}
}

async function login() {
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("password").value }) });
    $("password").value = "";
    showAdmin();
    await load();
    message("Signed in.");
  } catch (error) { showError(error); }
}

async function logout() {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  $("admin-panel").hidden = true;
  $("login-panel").hidden = false;
  $("logout").hidden = true;
}

function showAdmin() {
  $("login-panel").hidden = true;
  $("admin-panel").hidden = false;
  $("logout").hidden = false;
}

async function load() {
  const payload = await api("/api/admin/config");
  state.document = { schemaVersion: payload.schemaVersion, communities: payload.communities, templates: payload.templates };
  state.savedDocument = structuredClone(state.document);
  state.revision = payload.revision;
  state.updatedAt = payload.updatedAt;
  state.webhookConfigured = payload.webhookConfigured;
  state.dirty = false;
  const communityIds = Object.keys(state.document.communities);
  const templateIds = Object.keys(state.document.templates);
  if (!state.selectedCommunity || !state.document.communities[state.selectedCommunity]) state.selectedCommunity = communityIds[0] || "";
  if (!state.selectedTemplate || !state.document.templates[state.selectedTemplate]) state.selectedTemplate = state.document.communities[state.selectedCommunity]?.templateId || templateIds[0] || "";
  render();
  clearConfigErrors();
}

function render() {
  renderLists();
  renderEditor();
  $("revision-status").textContent = `${state.dirty ? "Unsaved changes · " : "Saved · "}Revision ${state.revision}${state.updatedAt ? ` · ${new Date(state.updatedAt).toLocaleString()}` : ""}`;
  $("save-config").disabled = state.saving || !state.dirty;
  $("discard-config").disabled = state.saving || !state.dirty;
  $("webhook-status").textContent = state.webhookConfigured ? "Configured" : "Not configured";
}

function renderLists() {
  $("community-list").replaceChildren(...Object.entries(state.document.communities).map(([id, community]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `community-tab ${state.mode === "community" && id === state.selectedCommunity ? "active" : ""}`;
    button.dataset.selectCommunity = id;
    button.innerHTML = `<span>${escapeHtml(community.name || id)}</span><small>${community.active ? "Active" : "Inactive"}</small>`;
    return button;
  }));
  $("template-list").replaceChildren(...Object.entries(state.document.templates).map(([id, template]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `community-tab ${state.mode === "template" && id === state.selectedTemplate ? "active" : ""}`;
    button.dataset.selectTemplate = id;
    button.innerHTML = `<span>${escapeHtml(id)}</span><small>${templateUsers(id)} ${templateUsers(id) === 1 ? "community" : "communities"}</small>`;
    return button;
  }));
}

function renderEditor() {
  if (state.mode === "template") {
    const template = state.document.templates[state.selectedTemplate];
    $("editor").innerHTML = template ? renderTemplateEditor(state.selectedTemplate, template) : emptyEditor("Create a template to begin.");
    return;
  }
  const community = state.document.communities[state.selectedCommunity];
  $("editor").innerHTML = community ? renderCommunityEditor(state.selectedCommunity, community) : emptyEditor("Create a community to begin.");
}

function renderCommunityEditor(id, community) {
  const options = Object.entries(state.document.templates).map(([templateId]) => `<option value="${escapeHtml(templateId)}" ${templateId === community.templateId ? "selected" : ""}>${escapeHtml(templateId)}</option>`).join("");
  return `<article class="card"><div class="card-header"><div><h2>Edit community</h2><p>ID <code>${escapeHtml(id)}</code> is immutable after creation.</p></div><span class="status-pill">${community.active ? "Published" : "Draft"}</span></div><div class="form-grid"><label class="field"><span>Community name</span><input data-path="communities.${id}.name" value="${escapeHtml(community.name)}"></label><label class="field"><span>Brand mark</span><input data-path="communities.${id}.brandMark" value="${escapeHtml(community.brandMark)}" maxlength="20"></label><label class="field"><span>Logo asset</span><select data-path="communities.${id}.logo"><option value="assets/logos/harborview.svg" ${community.logo === "assets/logos/harborview.svg" ? "selected" : ""}>Harborview</option><option value="assets/logos/northside.svg" ${community.logo === "assets/logos/northside.svg" ? "selected" : ""}>Northside</option></select></label><label class="field"><span>Accent color</span><div class="color-control"><input type="color" data-color-for="communities.${id}.theme.accent" value="${escapeHtml(community.theme.accent)}"><input data-path="communities.${id}.theme.accent" value="${escapeHtml(community.theme.accent)}" pattern="#[0-9a-fA-F]{6}"></div></label><label class="field full"><span>Footer text</span><input data-path="communities.${id}.footer" value="${escapeHtml(community.footer)}"></label><label class="check-row full"><input type="checkbox" data-path="communities.${id}.active" ${community.active ? "checked" : ""}><span>Published and available to applicants</span></label><label class="field full"><span>Assigned template</span><select data-path="communities.${id}.templateId">${options}</select></label></div><div class="actions"><button class="button danger" data-action="remove-community" type="button" ${Object.keys(state.document.communities).length < 2 ? "disabled" : ""}>Delete community</button><button class="button secondary" data-action="edit-assigned-template" type="button">Edit assigned template</button></div></article>`;
}

function renderTemplateEditor(id, template) {
  const steps = STEPS.map((key) => copyCard(`templates.${id}.steps.${key}`, key, template.steps[key])).join("");
  const completion = COMPLETION.map((key) => copyCard(`templates.${id}.completion.${key}`, key, template.completion[key])).join("");
  const form = FORM_FIELDS.map((key) => textControl(`templates.${id}.form.${key}`, humanize(key), template.form[key], key.includes("Placeholder") || key.includes("Hint"))).join("");
  const assigned = templateUsers(id);
  return `<article class="card"><div class="card-header"><div><h2>Edit template</h2><p><code>${escapeHtml(id)}</code> · shared by ${assigned} ${assigned === 1 ? "community" : "communities"}</p></div><span class="status-pill">Reusable content</span></div><p class="notice">Changes affect every assigned community. Duplicate this template when a community needs different application content.</p><section><h3 class="section-label">Applicant steps</h3><div class="copy-grid">${steps}</div></section><section><h3 class="section-label">Completion screens</h3><div class="copy-grid">${completion}</div></section><section><h3 class="section-label">Form labels and hints</h3><div class="form-grid">${form}</div></section>${instructionsEditor(id, template)}${captchaEditor(id, template)}${animalsEditor(id, template)}${uploadsEditor(id, template)}${reviewEditor(id, template)}${buttonsEditor(id, template)}<div class="actions"><button class="button secondary" data-action="duplicate-template" type="button">Duplicate template</button><button class="button danger" data-action="remove-template" type="button" ${assigned ? "disabled title=\"Reassign communities before deleting this template.\"" : ""}>Delete template</button></div></article>`;
}

function copyCard(path, label, value = {}) {
  return `<fieldset class="copy-card"><legend>${escapeHtml(humanize(label))}</legend>${textControl(`${path}.eyebrow`, "Eyebrow", value.eyebrow)}${textControl(`${path}.title`, "Title", value.title)}${textControl(`${path}.description`, "Description", value.description, true)}</fieldset>`;
}

function textControl(path, label, value = "", area = false) {
  const tag = area ? "textarea" : "input";
  return `<label class="field"><span>${escapeHtml(label)}</span><${tag} data-path="${escapeHtml(path)}">${area ? escapeHtml(value) : ""}</${tag}>`.replace(`></${tag}>`, area ? `>${escapeHtml(value)}</${tag}>` : ` value="${escapeHtml(value)}">`);
}

function instructionsEditor(id, template) {
  const prefix = `templates.${id}.instructions`;
  const checklist = (template.instructions.checklist || []).map((value, index, rows) => repeatText(`${prefix}.checklist.${index}`, value, "Checklist item", index, rows.length)).join("");
  const agreements = (template.instructions.checkboxes || []).map((row, index, rows) => `<div class="repeat-row"><label><span>ID</span><input data-path="${prefix}.checkboxes.${index}.id" value="${escapeHtml(row.id)}"></label><label><span>Agreement</span><input data-path="${prefix}.checkboxes.${index}.label" value="${escapeHtml(row.label)}"></label><label class="check-row"><input type="checkbox" data-path="${prefix}.checkboxes.${index}.required" ${row.required ? "checked" : ""}><span>Required</span></label>${reorderControls(`${prefix}.checkboxes.${index}`, index, rows.length)}<button class="remove" data-action="remove" data-path="${prefix}.checkboxes.${index}" type="button">Remove</button></div>`).join("");
  return `<section><h3 class="section-label">Instructions and agreements</h3><div class="subsection"><h4>Checklist</h4><div class="repeat-list">${checklist}</div><button class="button secondary small" data-action="add" data-path="${prefix}.checklist" data-kind="text" type="button">Add checklist item</button></div><div class="subsection"><h4>Agreements</h4><div class="repeat-list">${agreements}</div><button class="button secondary small" data-action="add" data-path="${prefix}.checkboxes" data-kind="agreement" type="button">Add agreement</button></div></section>`;
}

function captchaEditor(id, template) {
  const prefix = `templates.${id}.captcha`;
  return `<section><h3 class="section-label">Animal instructions</h3><div class="form-grid"><label class="field full"><span>Applicant introduction</span><textarea data-path="${prefix}.animalIntro">${escapeHtml(template.captcha.animalIntro)}</textarea><small class="hint">Shown beneath the Animals step heading.</small></label><label class="field full"><span>Bullet points</span><textarea data-path="${prefix}.animalBullets" data-array="true">${escapeHtml((template.captcha.animalBullets || []).join("\n"))}</textarea><small class="hint">One item per line.</small></label></div></section>`;
}

function animalsEditor(id, template) {
  const prefix = `templates.${id}.animals`;
  const rows = (template.animals || []).map((row, index, allRows) => `<div class="repeat-row animal-row"><label><span>ID</span><input data-path="${prefix}.${index}.id" value="${escapeHtml(row.id)}"></label><label><span>Animal name</span><input data-path="${prefix}.${index}.name" value="${escapeHtml(row.name)}"></label><label><span>Upload title</span><input data-path="${prefix}.${index}.title" value="${escapeHtml(row.title)}"></label>${reorderControls(`${prefix}.${index}`, index, allRows.length)}<button class="remove" data-action="remove" data-path="${prefix}.${index}" type="button">Remove</button></div>`).join("");
  return `<section><h3 class="section-label">Animals</h3><div class="repeat-list">${rows}</div><button class="button secondary small" data-action="add" data-path="${prefix}" data-kind="animal" type="button">Add animal</button></section>`;
}

function uploadsEditor(id, template) {
  const prefix = `templates.${id}.allowedUploads`;
  return `<section><h3 class="section-label">Upload settings</h3><div class="form-grid">${["application", "animal"].map((type) => `<fieldset class="copy-card"><legend>${humanize(type)} upload</legend>${textControl(`${prefix}.${type}.accept`, "Allowed extensions", template.allowedUploads[type].accept)}${textControl(`${prefix}.${type}.label`, "Helper label", template.allowedUploads[type].label)}<label class="field"><span>Maximum bytes</span><input type="number" min="1" max="3000000" data-path="${prefix}.${type}.maxBytes" value="${template.allowedUploads[type].maxBytes}"></label></fieldset>`).join("")}</div></section>`;
}

function reviewEditor(id, template) {
  const prefix = `templates.${id}.reviewFields`;
  const fields = (template.reviewFields || []).map((row, index, rows) => `<div class="repeat-row"><label><span>Field</span><select data-path="${prefix}.${index}.id">${REVIEW_FIELDS.map(([fieldId, label]) => `<option value="${fieldId}" ${row.id === fieldId ? "selected" : ""}>${label}</option>`).join("")}</select></label><label><span>Label</span><input data-path="${prefix}.${index}.label" value="${escapeHtml(row.label)}"></label><label class="check-row"><input type="checkbox" data-path="${prefix}.${index}.enabled" ${row.enabled ? "checked" : ""}><span>Shown</span></label>${reorderControls(`${prefix}.${index}`, index, rows.length)}<button class="remove" data-action="remove" data-path="${prefix}.${index}" type="button">Remove</button></div>`).join("");
  return `<section><h3 class="section-label">Review fields</h3><div class="repeat-list">${fields}</div><button class="button secondary small" data-action="add" data-path="${prefix}" data-kind="review" type="button">Add review field</button></section>`;
}

function buttonsEditor(id, template) {
  const prefix = `templates.${id}.buttons`;
  return `<section><h3 class="section-label">Button labels</h3><div class="form-grid">${["continue", "next", "back", "complete", "remove"].map((key) => textControl(`${prefix}.${key}`, humanize(key), template.buttons[key])).join("")}</div></section>`;
}

function repeatText(path, value, label, index, count) {
  return `<div class="repeat-row"><label class="field full"><span>${label}</span><input data-path="${path}" value="${escapeHtml(value)}"></label>${reorderControls(path, index, count)}<button class="remove" data-action="remove" data-path="${path}" type="button">Remove</button></div>`;
}

function reorderControls(path, index, count) {
  return `<span class="reorder-controls"><button class="remove" data-action="move-up" data-path="${path}" type="button" ${index <= 0 ? "disabled" : ""} aria-label="Move up">Up</button><button class="remove" data-action="move-down" data-path="${path}" type="button" ${index >= count - 1 ? "disabled" : ""} aria-label="Move down">Down</button></span>`;
}

function selectItem(event) {
  const button = event.target.closest("[data-select-community], [data-select-template]");
  if (!button) return;
  if (button.dataset.selectCommunity) {
    state.mode = "community";
    state.selectedCommunity = button.dataset.selectCommunity;
    state.selectedTemplate = state.document.communities[state.selectedCommunity]?.templateId || state.selectedTemplate;
  } else {
    state.mode = "template";
    state.selectedTemplate = button.dataset.selectTemplate;
  }
  render();
}

function editorInput(event) {
  const input = event.target;
  const path = input.dataset.path || input.dataset.colorFor;
  if (!path) return;
  const value = input.type === "checkbox"
    ? input.checked
    : input.dataset.array
      ? input.value.split("\n").map((item) => item.trim()).filter(Boolean)
      : input.value;
  setPath(state.document, path, value);
  if (input.type === "color") {
    const textInput = event.currentTarget.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (textInput) textInput.value = input.value;
  }
  state.dirty = true;
  renderLists();
  $("revision-status").textContent = `Unsaved changes · Revision ${state.revision}`;
  $("save-config").disabled = false;
}

function editorClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "add") addRepeater(button.dataset.path, button.dataset.kind);
  if (action === "remove") removePath(button.dataset.path);
  if (action === "move-up") moveRepeater(button.dataset.path, -1);
  if (action === "move-down") moveRepeater(button.dataset.path, 1);
  if (action === "remove-community") removeCommunity();
  if (action === "remove-template") removeTemplate();
  if (action === "duplicate-template") duplicateTemplate();
  if (action === "edit-assigned-template") { state.mode = "template"; state.selectedTemplate = state.document.communities[state.selectedCommunity].templateId; render(); }
}

function addRepeater(path, kind) {
  const values = getPath(state.document, path);
  if (!Array.isArray(values)) return;
  if (kind === "review" && values.length >= REVIEW_FIELDS.length) return message("All supported review fields are already included.", true);
  if (kind === "agreement" && values.length >= 20) return message("The maximum number of agreements is 20.", true);
  if (kind === "animal" && values.length >= 10) return message("The maximum number of animals is 10.", true);
  if (kind === "review") {
    const used = new Set(values.map((row) => row.id));
    const next = REVIEW_FIELDS.find(([id]) => !used.has(id));
    values.push({ id: next[0], label: next[1], enabled: true });
  } else {
    values.push(kind === "agreement" ? { id: `agreement-${nextId(values)}`, label: "New agreement", required: true } : kind === "animal" ? { id: `animal-${nextId(values)}`, name: "the animal", title: "Upload an animal picture" } : "New checklist item");
  }
  state.dirty = true;
  render();
}

function nextId(values) {
  const used = new Set(values.filter((value) => value && typeof value === "object").map((value) => value.id));
  let number = values.length + 1;
  while (used.has(`agreement-${number}`) || used.has(`animal-${number}`)) number += 1;
  return number;
}

function removePath(path) {
  const parts = path.split(".");
  const key = parts.pop();
  const parent = getPath(state.document, parts.join("."));
  if (Array.isArray(parent)) {
    if (parent.length <= 1) return message("At least one item must remain.", true);
    parent.splice(Number(key), 1);
  } else if (parent) delete parent[key];
  state.dirty = true;
  renderEditor();
  render();
}

function moveRepeater(path, direction) {
  const parts = path.split(".");
  const index = Number(parts.pop());
  const rows = getPath(state.document, parts.join("."));
  const target = index + direction;
  if (!Array.isArray(rows) || !Number.isInteger(index) || target < 0 || target >= rows.length) return;
  [rows[index], rows[target]] = [rows[target], rows[index]];
  state.dirty = true;
  render();
}

function duplicateTemplate() {
  const sourceId = state.selectedTemplate;
  const source = state.document.templates[sourceId];
  if (!source) return;
  const suggested = `${sourceId}-copy`;
  const id = prompt("New template ID", suggested);
  if (!id || !COMMUNITY_ID_PATTERN.test(id) || state.document.templates[id]) return message("Enter a unique valid template ID.", true);
  state.document.templates[id] = structuredClone(source);
  state.selectedTemplate = id;
  state.mode = "template";
  state.dirty = true;
  render();
}

function addCommunity() {
  const id = prompt("New community ID");
  if (!id || !COMMUNITY_ID_PATTERN.test(id) || state.document.communities[id]) return message("Enter a unique valid community ID.", true);
  const templateId = ensureTemplate();
  state.document.communities[id] = { name: "New community", logo: "assets/logos/harborview.svg", brandMark: "APP", footer: "Applications are reviewed by the community team.", theme: { accent: "#14345B" }, templateId, active: false };
  state.selectedCommunity = id;
  state.selectedTemplate = templateId;
  state.mode = "community";
  state.dirty = true;
  render();
}

function ensureTemplate() {
  const selected = state.document.templates[state.selectedTemplate]
    ? state.selectedTemplate
    : Object.keys(state.document.templates)[0];
  if (selected) return selected;
  let id = "starter-template";
  let suffix = 2;
  while (state.document.templates[id]) id = `starter-template-${suffix++}`;
  state.document.templates[id] = defaultTemplate();
  return id;
}

function addTemplate() {
  const id = prompt("New template ID");
  if (!id || !COMMUNITY_ID_PATTERN.test(id) || state.document.templates[id]) return message("Enter a unique valid template ID.", true);
  state.document.templates[id] = defaultTemplate();
  state.selectedTemplate = id;
  state.mode = "template";
  state.dirty = true;
  render();
}

function removeCommunity() {
  if (Object.keys(state.document.communities).length < 2) return message("At least one community must remain.", true);
  if (!confirm("Delete this community?")) return;
  delete state.document.communities[state.selectedCommunity];
  state.selectedCommunity = Object.keys(state.document.communities)[0] || "";
  state.dirty = true;
  render();
}

function removeTemplate() {
  if (templateUsers(state.selectedTemplate)) return message("Reassign communities before deleting this template.", true);
  if (!confirm("Delete this template?")) return;
  delete state.document.templates[state.selectedTemplate];
  state.selectedTemplate = Object.keys(state.document.templates)[0] || "";
  state.mode = "template";
  state.dirty = true;
  render();
}

async function saveConfiguration() {
  state.saving = true;
  render();
  try {
    const result = await api("/api/admin/config", { method: "PUT", body: JSON.stringify({ document: state.document, revision: state.revision }) });
    state.revision = result.revision;
    state.savedDocument = structuredClone(state.document);
    state.dirty = false;
    message("Configuration saved.");
    render();
  } catch (error) {
    state.saving = false;
    if (error.status === 409) {
      download("configuration-draft.json", JSON.stringify(state.document, null, 2));
      message("The server changed. Your unsaved draft remains open and was downloaded for safekeeping.", true);
    } else showError(error);
  } finally { state.saving = false; render(); }
}

function exportConfiguration() {
  download("configuration.json", JSON.stringify({ schemaVersion: state.document.schemaVersion, communities: state.document.communities, templates: state.document.templates }, null, 2));
}

async function importConfiguration(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!confirm("Replace the current configuration with this imported document?")) return;
  try {
    const parsed = JSON.parse(await file.text());
    const result = await api("/api/admin/config/import", { method: "POST", body: JSON.stringify({ document: parsed, revision: state.revision }) });
    state.revision = result.revision;
    await load();
    message("Configuration imported.");
  } catch (error) { showError(error); }
}

async function saveWebhook() {
  try {
    const result = await api("/api/admin/discord", { method: "PUT", body: JSON.stringify({ webhook: $("webhook").value.trim(), revision: state.revision }) });
    state.revision = result.revision;
    state.webhookConfigured = result.webhookConfigured;
    $("webhook").value = "";
    message("Shared webhook saved.");
    render();
  } catch (error) { showError(error); }
}

function discardConfiguration() {
  if (!state.dirty || !confirm("Discard all unsaved changes?")) return;
  state.document = structuredClone(state.savedDocument);
  state.dirty = false;
  render();
  clearConfigErrors();
  message("Unsaved changes discarded.");
}

function emptyEditor(text) { return `<article class="card"><h2>${escapeHtml(text)}</h2></article>`; }
function templateUsers(id) { return Object.values(state.document.communities).filter((community) => community.templateId === id).length; }
function humanize(value) { return String(value).replace(/([A-Z])/g, " $1").replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()); }
function getPath(object, path) { return path.split(".").filter(Boolean).reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) { const parts = path.split("."); const key = parts.pop(); let target = object; for (const part of parts) { if (!target[part] || typeof target[part] !== "object") target[part] = {}; target = target[part]; } target[key] = value; }
function defaultTemplate() { const copy = () => ({ eyebrow: "Application", title: "Tell us about yourself", description: "Share a few details with the community team." }); return { steps: Object.fromEntries(STEPS.map((key) => [key, copy()])), completion: { success: copy(), next: copy() }, form: { addressLabel: "Address", addressHint: "Where would you like to help?", letterLabel: "Your letter", letterPlaceholder: "Tell us about yourself", experienceLabel: "Experience", experiencePlaceholder: "Share relevant experience", referralLabel: "Referral", referralPlaceholder: "How did you hear about us?" }, instructions: { checklist: ["Review your information before continuing."], checkboxes: [{ id: "consent", label: "I confirm that the information I provided is accurate.", required: true }] }, captcha: { animalIntro: "Upload a picture for each animal.", animalBullets: ["Use a clear, recent image."] }, animals: [{ id: "animal", name: "the animal", title: "Upload an animal picture" }], allowedUploads: { application: { accept: ".pdf,.png,.jpg,.jpeg,.webp", label: "PDF or image", maxBytes: 3000000 }, animal: { accept: ".png,.jpg,.jpeg,.webp", label: "PNG, JPG, or WEBP image", maxBytes: 3000000 } }, reviewFields: REVIEW_FIELDS.map(([id, label]) => ({ id, label, enabled: true })), buttons: { continue: "Continue", next: "Next step", back: "Back", complete: "Complete application", remove: "Remove file" } }; }
function download(name, content) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "application/json" })); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
function message(text, error = false) { $("message").textContent = text; $("message").className = error ? "alert" : "notice"; if (!error) clearConfigErrors(); }
function showError(error) { message(error.message, true); const fields = error.payload?.fields || []; renderConfigErrors(fields.map((field) => typeof field === "string" ? field : `${field.path}: ${field.message}`)); }
function renderConfigErrors(fields) { const region = $("config-errors"); region.replaceChildren(); if (!fields.length) { region.hidden = true; return; } const list = document.createElement("ul"); fields.forEach((field) => { const item = document.createElement("li"); item.textContent = field; list.append(item); }); region.append(list); region.hidden = false; }
function clearConfigErrors() { $("config-errors").replaceChildren(); $("config-errors").hidden = true; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
