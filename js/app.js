import { loadCommunityConfiguration, getUploadSettings } from "./config.js";
import { applicationState, clearErrors, setErrors, updateNestedState } from "./state.js";
import { compressImage, isCompressibleImage } from "./image-compression.js";
import { IMAGE_TOO_LARGE, IMAGE_TOO_LARGE_DETAIL, submitApplication } from "./captcha.js";
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
  if (applicationState.isSubmitting || applicationState.isLoading) return;
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
  if (!target || applicationState.isSubmitting || applicationState.isLoading) return;
  event.preventDefault();
  target.classList.add("is-dragover");
});

stepRegion.addEventListener("dragleave", (event) => {
  const target = event.target.closest("[data-drop-target]");
  if (target) target.classList.remove("is-dragover");
});

stepRegion.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-drop-target]");
  if (!target || applicationState.isSubmitting || applicationState.isLoading) return;
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
    const result = await submitApplication({
      communityId: applicationState.community.id,
      state: applicationState,
      onPreparing: (message) => {
        applicationState.isLoading = true;
        applicationState.loadingMessage = message;
        renderCurrentStep();
      }
    });
    applicationState.applicationId = result.applicationId || "";
    applicationState.isSubmitting = false;
    applicationState.isLoading = false;
    applicationState.loadingMessage = "";
    clearErrors();
    applicationState.currentStep = 8;
    renderCurrentStep();
  } catch (error) {
    applicationState.isSubmitting = false;
    applicationState.isLoading = false;
    applicationState.loadingMessage = "";
    const details = Object.values(error.fields || {}).filter(Boolean);
    const message = error.image
      ? `${IMAGE_TOO_LARGE}\n${IMAGE_TOO_LARGE_DETAIL}`
      : details.length
        ? `Some application details need attention: ${details.join(" ")}`
        : error.message;
    setErrors({ form: message });
    renderCurrentStep();
  }
}

let uploadOperation = 0;

async function setFile(path, file) {
  if (!file || applicationState.isSubmitting || applicationState.isLoading) return;
  const operation = ++uploadOperation;
  const type = path.startsWith("uploads.animals.") ? "animal" : "application";
  const settings = getUploadSettings(applicationState.community, type);
  const errorPath = type === "animal" ? path.split(".").pop() : "experienceUpload";
  const preliminaryError = validateFile(file, settings, { skipSize: true });
  if (preliminaryError) {
    setUploadError(type, errorPath, preliminaryError);
    renderCurrentStep();
    return;
  }

  applicationState.isLoading = true;
  applicationState.loadingMessage = isCompressibleImage(file) ? "Optimizing your image…" : "Preparing your file…";
  renderCurrentStep();
  try {
    const result = await compressImage(file, {
      maxBytes: Math.min(settings.maxBytes, 3_000_000),
      accepted: settings.accept
    });
    if (operation !== uploadOperation) return;

    if (result.failed && isCompressibleImage(file) && result.file.size > Math.min(settings.maxBytes, 3_000_000)) {
      setUploadError(type, errorPath, `${IMAGE_TOO_LARGE}\n${IMAGE_TOO_LARGE_DETAIL}`);
      return;
    }

    const processedFile = result.file;
    const error = validateFile(processedFile, settings);
    if (error) {
      setUploadError(type, errorPath, isCompressibleImage(file) && processedFile.size > settings.maxBytes
        ? `${IMAGE_TOO_LARGE}\n${IMAGE_TOO_LARGE_DETAIL}`
        : error);
      return;
    }

    updateNestedState(path, processedFile);
    if (type === "animal") delete applicationState.errors.animals?.[errorPath];
    else delete applicationState.errors.experienceUpload;
  } catch {
    if (operation === uploadOperation) setUploadError(type, errorPath, "This file could not be processed. Choose a different file.");
  } finally {
    if (operation === uploadOperation) {
      applicationState.isLoading = false;
      applicationState.loadingMessage = "";
      renderCurrentStep();
    }
  }
}

function setUploadError(type, path, message) {
  setErrors(type === "animal" ? { animals: { [path]: message } } : { experienceUpload: message });
}

function formatBytes(bytes) {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.round(bytes / 1_000)} KB`;
}

function removeFile(path) {
  uploadOperation += 1;
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
