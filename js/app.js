import { loadCommunityConfiguration, getUploadSettings } from "./config.js";
import { applicationState, clearErrors, setErrors, updateNestedState } from "./state.js";
import { submitApplication } from "./captcha.js";
import { validateFile, validateStep } from "./validation.js";
import { renderProgress, renderStep, setBranding, showApplicationError, showApplicationShell } from "./ui.js";

const stepRegion = document.querySelector("#step-region");

startApplication();

async function startApplication() {
  try {
    const community = await loadCommunityConfiguration();
    applicationState.community = community;
    setBranding(community);
    showApplicationShell();
    renderCurrentStep();
  } catch (error) {
    showApplicationError(error);
  }
}

function renderCurrentStep() {
  if (!applicationState.community) return;
  renderProgress(applicationState.currentStep);
  stepRegion.innerHTML = renderStep(applicationState.currentStep, applicationState.community, applicationState);
  stepRegion.setAttribute("aria-busy", applicationState.isSubmitting || applicationState.isLoading ? "true" : "false");

  focusStepHeading();
}

function focusStepHeading() {
  const heading = document.querySelector("#page-heading");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
}

stepRegion.addEventListener("input", (event) => {
  const input = event.target;
  const path = input.dataset.statePath;
  if (!path) return;
  updateNestedState(path, input.value);
  clearFieldError(input);
});

stepRegion.addEventListener("change", (event) => {
  const input = event.target;
  if (input.matches("[data-agreement-id]")) {
    applicationState.agreements[input.dataset.agreementId] = input.checked;
    if (applicationState.errors.agreements) delete applicationState.errors.agreements[input.dataset.agreementId];
    return;
  }

  if (input.matches("[data-file-path]")) {
    const file = input.files?.[0];
    setFile(input.dataset.filePath, file);
  }
});

stepRegion.addEventListener("click", async (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement || applicationState.isSubmitting || applicationState.isLoading) return;

  const action = actionElement.dataset.action;
  if (action === "back") await goBack();
  if (action === "next") await handleNext();
  if (action === "remove-file") removeFile(actionElement.dataset.filePath);
  if (action === "show-next") await transitionToStep(9, "Opening the final details for you…");
});

stepRegion.addEventListener("dragover", (event) => {
  const target = event.target.closest("[data-drop-target]");
  if (!target) return;
  event.preventDefault();
  target.classList.add("is-dragover");
});

stepRegion.addEventListener("dragleave", (event) => {
  const target = event.target.closest("[data-drop-target]");
  if (target) target.classList.remove("is-dragover");
});

stepRegion.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-drop-target]");
  if (!target) return;
  event.preventDefault();
  target.classList.remove("is-dragover");
  setFile(target.dataset.dropTarget, event.dataTransfer.files?.[0]);
});

async function handleNext() {
  const step = applicationState.currentStep;
  const errors = validateStep(step, applicationState.community, applicationState);
  if (Object.keys(errors).length) {
    setErrors(errors);
    renderCurrentStep();
    return;
  }
  clearErrors();
  if (step === 7) {
    await sendApplication();
    return;
  }
  await transitionToStep(step + 1, loadingMessageFor(step + 1));
}

async function goBack() {
  if (applicationState.currentStep <= 1) return;
  clearErrors();
  await transitionToStep(applicationState.currentStep - 1, "Taking you back to the previous step…");
}

async function transitionToStep(step, message) {
  applicationState.currentStep = step;
  applicationState.isLoading = true;
  applicationState.loadingMessage = message;
  renderCurrentStep();

  await wait(260);
  applicationState.isLoading = false;
  applicationState.loadingMessage = "";
  renderCurrentStep();
}

function loadingMessageFor(step) {
  const messages = {
    2: "Bringing up the community details…",
    3: "Making space for your story…",
    4: "Preparing the supporting file upload…",
    5: "Preparing the agreement checklist…",
    6: "Preparing the animal picture check…",
    7: "Putting your application summary together…"
  };
  return messages[step] || "Preparing the next step…";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendApplication() {
  applicationState.isSubmitting = true;
  renderCurrentStep();
  try {
    const result = await submitApplication({ communityId: applicationState.community.id, state: applicationState });
    applicationState.applicationId = result.applicationId || "";
    applicationState.isSubmitting = false;
    clearErrors();
    applicationState.currentStep = 8;
    renderCurrentStep();
  } catch (error) {
    applicationState.isSubmitting = false;
    const details = Object.values(error.fields || {}).filter(Boolean);
    setErrors({ form: details.length ? `Some application details need attention: ${details.join(" ")}` : error.message });
    renderCurrentStep();
  }
}

function setFile(path, file) {
  if (!file) return;
  const type = path.startsWith("uploads.animals.") ? "animal" : "application";
  const settings = getUploadSettings(applicationState.community, type);
  const error = validateFile(file, settings);
  if (error) {
    setErrors(type === "animal" ? { animals: { [path.split(".").pop()]: error } } : { experienceUpload: error });
    renderCurrentStep();
    return;
  }

  updateNestedState(path, file);
  if (type === "animal") {
    delete applicationState.errors.animals?.[path.split(".").pop()];
  } else {
    delete applicationState.errors.experienceUpload;
  }
  renderCurrentStep();
}

function removeFile(path) {
  updateNestedState(path, null);
  if (path === "uploads.experience") delete applicationState.errors.experienceUpload;
  if (path.startsWith("uploads.animals.")) delete applicationState.errors.animals?.[path.split(".").pop()];
  renderCurrentStep();
}

function clearFieldError(input) {
  const field = input.closest(".field");
  if (field) {
    field.classList.remove("has-error");
    const error = field.querySelector(".error-message");
    if (error) error.textContent = "";
  }
}
