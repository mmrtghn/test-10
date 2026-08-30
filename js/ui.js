import { TOTAL_STEPS } from "./state.js";
import { getUploadSettings } from "./config.js";

const DEFAULT_REVIEW_FIELDS = [
  { id: "name", label: "Name", enabled: true },
  { id: "contact", label: "Contact", enabled: true },
  { id: "communityCenter", label: "Community center", enabled: true },
  { id: "experienceFile", label: "Experience file", enabled: true },
  { id: "animalPictures", label: "Animal pictures", enabled: true }
];
const REVIEW_FIELD_IDS = new Set(DEFAULT_REVIEW_FIELDS.map((field) => field.id));

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function setBranding(community) {
  const logo = document.querySelector("#brand-logo");
  const name = document.querySelector("#brand-name");
  const footer = document.querySelector("#site-footer");

  logo.src = community.logo;
  logo.alt = `${community.name} logo`;
  name.textContent = community.name;
  footer.textContent = community.footer;
  applyTheme(community.theme?.accent);
  document.title = `${community.name} application`;
}

function applyTheme(accent) {
  if (!/^#[0-9a-f]{6}$/i.test(String(accent || ""))) return;
  const root = document.documentElement;
  const rgb = hexToRgb(accent);
  root.style.setProperty("--color-primary", accent);
  root.style.setProperty("--color-primary-deep", mix(rgb, 0.78));
  root.style.setProperty("--color-primary-soft", mix(rgb, 0.90));
  root.style.setProperty("--focus-ring", `0 0 0 4px ${rgba(rgb, 0.2)}`);
}

function hexToRgb(hex) {
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) };
}

function mix(rgb, amount) {
  return `rgb(${Math.round(rgb.r * amount)}, ${Math.round(rgb.g * amount)}, ${Math.round(rgb.b * amount)})`;
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

export function renderProgress(currentStep) {
  const label = document.querySelector("#progress-label");
  const percent = document.querySelector("#progress-percent");
  const indicator = document.querySelector("#progress-indicator");
  const isFinalScreen = currentStep > TOTAL_STEPS;
  const progressStep = Math.min(currentStep, TOTAL_STEPS);

  if (isFinalScreen) {
    label.textContent = "Application complete";
    percent.textContent = "100%";
  } else {
    const completedPercent = Math.round((currentStep / TOTAL_STEPS) * 100);
    label.textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
    percent.textContent = `${completedPercent}%`;
  }

  indicator.innerHTML = Array.from({ length: TOTAL_STEPS }, (_, index) => {
    const stepNumber = index + 1;
    const isComplete = progressStep > stepNumber || isFinalScreen;
    const isActive = !isFinalScreen && progressStep === stepNumber;
    const nodeClass = [
      "progress-node",
      isComplete ? "is-complete" : "",
      isActive ? "is-active" : ""
    ].filter(Boolean).join(" ");
    const line = index < TOTAL_STEPS - 1
      ? `<span class="progress-line ${isComplete ? "is-complete" : ""}" aria-hidden="true"></span>`
      : "";

    return `<span class="progress-item"><span class="${nodeClass}" aria-label="Step ${stepNumber}${isActive ? ", current" : isComplete ? ", complete" : ""}"><span class="node-number">${stepNumber}</span></span>${line}</span>`;
  }).join("");
}

export function showApplicationShell() {
  document.querySelector("#app-error").hidden = true;
  document.querySelector("#application-card").hidden = false;
}

export function showApplicationError(error) {
  const card = document.querySelector("#app-error");
  const title = document.querySelector("#app-error-title");
  const message = document.querySelector("#app-error-message");
  title.textContent = "We couldn’t open this application";
  message.textContent = error?.message || "Please check your link and try again.";
  card.hidden = false;
  document.querySelector("#application-card").hidden = true;
}

export function renderStep(step, community, state) {
  if (state.isLoading) return renderLoadingStep(state);

  switch (step) {
    case 1: return renderPersonalStep(community, state);
    case 2: return renderCenterStep(community, state);
    case 3: return renderStoryStep(community, state);
    case 4: return renderExperienceUploadStep(community, state);
    case 5: return renderVerificationIntroStep(community, state);
    case 6: return renderAnimalStep(community, state);
    case 7: return renderReviewStep(community, state);
    case 8: return renderSuccessStep(community, state);
    case 9: return renderNextStep(community);
    default: return renderPersonalStep(community, state);
  }
}

function getStepCopy(community, key, fallback) {
  const configured = community.steps?.[key] || {};
  return {
    eyebrow: configured.eyebrow || fallback.eyebrow,
    title: configured.title || fallback.title,
    description: configured.description || fallback.description
  };
}

function getCompletionCopy(community, key, fallback) {
  const configured = community.completion?.[key];
  return {
    eyebrow: configured?.eyebrow || fallback.eyebrow,
    title: configured?.title || fallback.title,
    description: configured?.description || fallback.description
  };
}

function renderLoadingStep(state) {
  const message = state.loadingMessage || "Preparing the next step…";
  return `<div class="step-view loading-screen" role="status" aria-live="polite">
    <div class="loading-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="eyebrow">One moment</p>
    <h1 class="step-title" id="page-heading">Loading the next step</h1>
    <p class="step-description">${escapeHtml(message)}</p>
  </div>`;
}

function renderPersonalStep(community, state) {
  const copy = getStepCopy(community, "personal", {
    eyebrow: "Community application",
    title: "Let’s get to know you",
    description: "Start with a few details so the community team knows who to contact."
  });

  return stepView({
    ...copy,
    content: `<div class="form-grid">
      ${textField({ id: "first-name", label: "First name", path: "applicant.firstName", value: state.applicant.firstName, autocomplete: "given-name", required: true, error: state.errors.firstName })}
      ${textField({ id: "last-name", label: "Last name", path: "applicant.lastName", value: state.applicant.lastName, autocomplete: "family-name", required: true, error: state.errors.lastName })}
      ${textField({ id: "email", label: "Email address", path: "applicant.email", value: state.applicant.email, type: "email", autocomplete: "email", required: true, error: state.errors.email })}
      ${textField({ id: "phone", label: "Phone number", path: "applicant.phone", value: state.applicant.phone, type: "tel", autocomplete: "tel", required: true, error: state.errors.phone })}
    </div>`,
    actions: actionButtons({ next: community.buttons.next })
  });
}

function renderCenterStep(community, state) {
  const copy = getStepCopy(community, "center", {
    eyebrow: "Your community",
    title: "Where would you like to help?",
    description: "Tell us which community center or local program you’re applying to support."
  });

  return stepView({
    ...copy,
    content: `<div class="form-grid">
      ${textField({ id: "center-address", label: community.form.addressLabel, hint: community.form.addressHint, path: "communityCenter.address", value: state.communityCenter.address, autocomplete: "street-address", required: true, full: true, error: state.errors.address })}
      ${textField({ id: "center-state", label: "State or province", path: "communityCenter.state", value: state.communityCenter.state, autocomplete: "address-level1", required: true, error: state.errors.state })}
      ${textField({ id: "center-zip", label: "ZIP or postal code", path: "communityCenter.zip", value: state.communityCenter.zip, autocomplete: "postal-code", required: true, error: state.errors.zip })}
    </div>`,
    actions: actionButtons({ back: community.buttons.back, next: community.buttons.next })
  });
}

function renderStoryStep(community, state) {
  const copy = getStepCopy(community, "story", {
    eyebrow: "Your story",
    title: "Tell the team what brings you here",
    description: "A thoughtful answer helps us understand how you’d like to contribute."
  });

  return stepView({
    ...copy,
    content: `<div class="form-stack">
      ${textAreaField({ id: "letter", label: community.form.letterLabel, hint: "A few sentences is enough.", path: "application.letter", value: state.application.letter, placeholder: community.form.letterPlaceholder, required: true, error: state.errors.letter })}
      ${textAreaField({ id: "experience", label: community.form.experienceLabel, path: "application.volunteeringExperience", value: state.application.volunteeringExperience, placeholder: community.form.experiencePlaceholder, required: true, error: state.errors.volunteeringExperience })}
      ${textField({ id: "referral", label: community.form.referralLabel, optional: true, path: "application.referral", value: state.application.referral, placeholder: community.form.referralPlaceholder, error: state.errors.referral })}
    </div>`,
    actions: actionButtons({ back: community.buttons.back, next: community.buttons.next })
  });
}

function renderExperienceUploadStep(community, state) {
  const copy = getStepCopy(community, "experience", {
    eyebrow: "Supporting file",
    title: "Add one file about your experience",
    description: "A résumé, certificate, portfolio page, or another helpful document is welcome."
  });
  const settings = getUploadSettings(community, "application");

  return stepView({
    ...copy,
    content: uploadField({
      id: "experience-upload",
      inputId: "experience-file",
      title: "Choose a file or drop it here",
      settings,
      file: state.uploads.experience,
      path: "uploads.experience",
      error: state.errors.experienceUpload,
      removeLabel: community.buttons.remove
    }),
    actions: actionButtons({ back: community.buttons.back, next: community.buttons.next })
  });
}

function renderVerificationIntroStep(community, state) {
  const copy = getStepCopy(community, "verification", {
    eyebrow: "Almost there",
    title: "Let’s make sure you’re human",
    description: "A few quick checks help us keep applications safe and welcoming for everyone."
  });
  const checkboxes = community.instructions.checkboxes.map((item) => {
    const checked = Boolean(state.agreements[item.id]);
    return `<label class="checkbox-row ${state.errors.agreements?.[item.id] ? "is-error" : ""}">
      <input type="checkbox" data-agreement-id="${escapeHtml(item.id)}" ${checked ? "checked" : ""}>
      <span>${escapeHtml(item.label)}${item.required ? "" : " (optional)"}</span>
    </label>`;
  }).join("");
  const checklist = community.instructions.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return stepView({
    ...copy,
    content: `<div class="verification-panel">
      <ul class="check-list">${checklist}</ul>
      <div class="consent-list" role="group" aria-label="Required agreements">
        ${checkboxes}
        ${state.errors.agreements?.summary ? `<p class="inline-error">${escapeHtml(state.errors.agreements.summary)}</p>` : ""}
      </div>
    </div>`,
    actions: actionButtons({ back: community.buttons.back, next: community.buttons.continue })
  });
}

function renderAnimalStep(community, state) {
  const copy = getStepCopy(community, "animals", { eyebrow: "A picture check", title: "Show us the animals", description: "" });
  copy.description = community.captcha?.animalIntro || copy.description;
  const settings = getUploadSettings(community, "animal");
  const cards = community.animals.map((animal) => uploadField({ id: `animal-${animal.id}`, inputId: `animal-file-${animal.id}`, title: animal.title, description: `Please upload ${animal.name}.`, settings, file: state.uploads.animals[animal.id], path: `uploads.animals.${animal.id}`, error: state.errors.animals?.[animal.id], removeLabel: community.buttons.remove })).join("");
  return stepView({ ...copy, content: `<div class="animal-layout"><div class="animal-copy"><ul class="check-list">${community.captcha.animalBullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div><div class="form-stack">${cards}</div></div>`, actions: actionButtons({ back: community.buttons.back, next: community.buttons.next }) });
}

function renderReviewStep(community, state) {
  const copy = getStepCopy(community, "review", {
    eyebrow: "Ready to send",
    title: "Review your application",
    description: "Take a quick look before sending your application to the community team."
  });
  const reviewRows = getReviewFields(community).map((field) => reviewRow(
    field.label,
    reviewFieldValue(field.id, community, state)
  )).join("");

  return stepView({
    ...copy,
    content: `<div class="form-stack review-list">${reviewRows}</div>`,
    actions: actionButtons({ back: community.buttons.back, next: community.buttons.complete, submit: true, disabled: state.isSubmitting }),
    alert: state.errors.form
  });
}

function getReviewFields(community) {
  const configured = Array.isArray(community.reviewFields) ? community.reviewFields : DEFAULT_REVIEW_FIELDS;
  return configured.filter((field) => REVIEW_FIELD_IDS.has(field?.id) && field.enabled !== false && field.label);
}

function reviewFieldValue(id, community, state) {
  const fileName = state.uploads.experience?.name || "No file";
  const animalCount = Object.values(state.uploads.animals).filter(Boolean).length;
  const values = {
    name: [state.applicant.firstName, state.applicant.lastName].filter(Boolean).join(" "),
    contact: `${state.applicant.email} · ${state.applicant.phone}`,
    communityCenter: [state.communityCenter.address, state.communityCenter.state, state.communityCenter.zip].filter(Boolean).join(", "),
    experienceFile: fileName,
    animalPictures: `${animalCount} of ${community.animals.length} attached`
  };
  return values[id] || "";
}

function renderSuccessStep(community, state) {
  const copy = getCompletionCopy(community, "success", {
    eyebrow: "Application received",
    title: "Application received",
    description: "Your application was received for manual review."
  });

  return `<div class="step-view success-layout"><div><div class="success-mark" aria-hidden="true">✓</div><p class="eyebrow">${escapeHtml(copy.eyebrow)}</p><h1 class="step-title" id="page-heading">${escapeHtml(copy.title)}</h1><p class="step-description">${escapeHtml(copy.description)}</p>${state.applicationId ? `<p class="field-hint">Reference: ${escapeHtml(state.applicationId)}</p>` : ""}<div class="step-actions"><button class="button success-button" type="button" data-action="show-next">${escapeHtml(community.buttons.next)}</button></div></div></div>`;
}

function renderNextStep(community) {
  const copy = getCompletionCopy(community, "next", {
    eyebrow: "What’s next?",
    title: "What’s next?",
    description: "The community team will contact you if they need anything else."
  });

  return `<div class="step-view next-layout"><div><div class="next-icon" aria-hidden="true">${arrowIcon()}</div><p class="eyebrow">${escapeHtml(copy.eyebrow)}</p><h1 class="step-title" id="page-heading">${escapeHtml(copy.title)}</h1><p class="step-description">${escapeHtml(copy.description)}</p></div></div>`;
}

function stepView({ eyebrow, title, description, content, actions, alert = "" }) {
  const alertMarkup = alert ? `<div class="alert" role="alert"><span class="alert-icon" aria-hidden="true">!</span><span>${escapeHtml(alert)}</span></div>` : "";
  return `<div class="step-view"><header class="step-header"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1 class="step-title" id="page-heading">${escapeHtml(title)}</h1><p class="step-description">${escapeHtml(description)}</p></header>${alertMarkup}${content}${actions}</div>`;
}

function textField({ id, label, optional = false, hint = "", path, value = "", type = "text", autocomplete = "", placeholder = "", required = false, full = false, inputMode = "", maxLength = 0, error = "" }) {
  const errorId = error ? `${id}-error` : "";
  const errorMarkup = error
    ? `<span class="error-message" id="${escapeHtml(errorId)}" role="alert">${escapeHtml(error)}</span>`
    : `<span class="error-message" aria-hidden="true"></span>`;
  const describedBy = errorId ? `aria-describedby="${escapeHtml(errorId)}"` : "";
  const optionalMarkup = optional ? '<span class="optional">Optional</span>' : "";
  const hintMarkup = hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : "";
  const autocompleteMarkup = autocomplete ? `autocomplete="${escapeHtml(autocomplete)}"` : "";
  const placeholderMarkup = placeholder ? `placeholder="${escapeHtml(placeholder)}"` : "";
  const inputModeMarkup = inputMode ? `inputmode="${escapeHtml(inputMode)}"` : "";
  const maxLengthMarkup = maxLength ? `maxlength="${maxLength}"` : "";

  return `<div class="field ${full ? "full" : ""} ${error ? "has-error" : ""}"><label class="field-label" for="${escapeHtml(id)}"><span>${escapeHtml(label)}</span>${optionalMarkup}</label>${hintMarkup}<input class="text-input" id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" data-state-path="${escapeHtml(path)}" ${autocompleteMarkup} ${placeholderMarkup} ${inputModeMarkup} ${maxLengthMarkup} ${required ? "required" : ""} ${describedBy}>${errorMarkup}</div>`;
}

function textAreaField({ id, label, hint = "", path, value = "", placeholder = "", required = false, error = "" }) {
  const errorId = error ? `${id}-error` : "";
  const errorMarkup = error
    ? `<span class="error-message" id="${escapeHtml(errorId)}" role="alert">${escapeHtml(error)}</span>`
    : `<span class="error-message" aria-hidden="true"></span>`;
  const describedBy = errorId ? `aria-describedby="${escapeHtml(errorId)}"` : "";
  const hintMarkup = hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : "";
  return `<div class="field ${error ? "has-error" : ""}"><label class="field-label" for="${escapeHtml(id)}"><span>${escapeHtml(label)}</span></label>${hintMarkup}<textarea class="text-area" id="${escapeHtml(id)}" name="${escapeHtml(id)}" data-state-path="${escapeHtml(path)}" placeholder="${escapeHtml(placeholder)}" ${required ? "required" : ""} ${describedBy}>${escapeHtml(value)}</textarea>${errorMarkup}</div>`;
}

function uploadField({ id, inputId, title, description = "", settings, file, path, error, removeLabel }) {
  const selectedFile = file ? `<div class="upload-file"><span class="upload-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><button type="button" class="upload-file-remove" data-action="remove-file" data-file-path="${escapeHtml(path)}">${escapeHtml(removeLabel)}</button></div>` : "";
  const meta = `${escapeHtml(settings.label)} · up to ${formatBytes(settings.maxBytes)}`;
  const errorMarkup = error
    ? `<span class="error-message" role="alert">${escapeHtml(error)}</span>`
    : `<span class="error-message" aria-hidden="true"></span>`;
  return `<div class="field ${error ? "has-error" : ""}" id="${escapeHtml(id)}"><label class="upload-zone" for="${escapeHtml(inputId)}" data-drop-target="${escapeHtml(path)}"><span class="upload-icon" aria-hidden="true">${uploadIcon()}</span><span class="upload-title">${escapeHtml(title)}</span><span class="upload-meta">${escapeHtml(description || "Choose a file")}</span><span class="upload-meta">${meta}</span><input id="${escapeHtml(inputId)}" type="file" accept="${escapeHtml(settings.accept)}" data-file-path="${escapeHtml(path)}"></label>${selectedFile}${errorMarkup}</div>`;
}

function actionButtons({ back = "", next = "Next step", submit = false, disabled = false }) {
  const busy = submit && disabled;
  const buttonLabel = busy ? "Sending application…" : next;
  const spinner = busy ? '<span class="spinner" aria-hidden="true"></span>' : "";
  return `<div class="step-actions">${back ? `<button class="button secondary" type="button" data-action="back" ${disabled ? "disabled" : ""}>${escapeHtml(back)}</button>` : "<span></span>"}<button class="button" type="button" data-action="next" ${disabled ? "disabled" : ""}>${spinner}${escapeHtml(buttonLabel)}</button></div>`;
}

function reviewRow(label, value) {
  return `<div class="upload-file"><span class="field-label">${escapeHtml(label)}</span><span class="upload-file-name">${escapeHtml(value || "Not provided")}</span></div>`;
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${Math.round(bytes / 1_000)} KB`;
}

function uploadIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 13.5v4A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-4"/></svg>`;
}

function arrowIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 12h13m-5-5 5 5-5 5"/></svg>`;
}
