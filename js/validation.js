const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[+\d][\d\s().-]{6,29}$/;
const ZIP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,11}$/;

export function validateStep(step, community, state) {
  switch (step) {
    case 1: return validatePersonal(state);
    case 2: return validateCenter(state);
    case 3: return validateStory(state);
    case 4: return state.uploads.experience ? {} : { experienceUpload: "Please attach a file before continuing." };
    case 5: return validateAgreements(community, state);
    case 6: return validateAnimals(community, state);
    default: return {};
  }
}

function validatePersonal(state) {
  const errors = {};
  const firstName = state.applicant.firstName.trim();
  const lastName = state.applicant.lastName.trim();
  const email = state.applicant.email.trim();
  const phone = state.applicant.phone.trim();
  if (firstName.length < 1 || firstName.length > 80) errors.firstName = "Enter a valid first name.";
  if (lastName.length < 1 || lastName.length > 80) errors.lastName = "Enter a valid last name.";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (!PHONE_PATTERN.test(phone) || phone.length > 30) errors.phone = "Enter a valid phone number.";
  return errors;
}

function validateCenter(state) {
  const errors = {};
  const address = state.communityCenter.address.trim();
  const region = state.communityCenter.state.trim();
  const zip = state.communityCenter.zip.trim();
  if (address.length < 3 || address.length > 180) errors.address = "Enter a valid community center address.";
  if (region.length < 2 || region.length > 80) errors.state = "Enter a valid state or province.";
  if (!ZIP_PATTERN.test(zip)) errors.zip = "Enter a valid ZIP or postal code.";
  return errors;
}

function validateStory(state) {
  const errors = {};
  const letterLength = state.application.letter.trim().length;
  const experienceLength = state.application.volunteeringExperience.trim().length;
  const referralLength = state.application.referral.trim().length;
  if (letterLength < 20 || letterLength > 4_000) errors.letter = "The letter must be between 20 and 4,000 characters.";
  if (experienceLength < 20 || experienceLength > 4_000) errors.volunteeringExperience = "The experience must be between 20 and 4,000 characters.";
  if (referralLength > 500) errors.referral = "The referral answer is too long.";
  return errors;
}

function validateAgreements(community, state) {
  const missing = {};
  for (const item of community.instructions.checkboxes) {
    if (item.required && !state.agreements[item.id]) missing[item.id] = "This agreement is required.";
  }
  if (Object.keys(missing).length) {
    return { agreements: { ...missing, summary: "Please confirm each required agreement." } };
  }
  return {};
}

function validateAnimals(community, state) {
  const errors = {};
  for (const animal of community.animals) {
    if (!state.uploads.animals[animal.id]) errors[animal.id] = `Please upload ${animal.name}.`;
  }
  return Object.keys(errors).length ? { animals: errors } : {};
}

export function validateFile(file, settings) {
  if (!file) return "Choose a file before continuing.";
  if (file.size > settings.maxBytes) return `This file is too large. Choose a file under ${formatBytes(settings.maxBytes)}.`;
  const accepted = settings.accept.split(",").map((item) => item.trim().toLowerCase());
  const extension = `.${file.name.split(".").pop().toLowerCase()}`;
  if (!accepted.includes(extension)) return `Choose a ${settings.label} file.`;
  if (!file.name || file.name.length > 120 || /[\\/\0]/.test(file.name)) return "Use a shorter, valid filename.";
  return "";
}

function formatBytes(bytes) {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 1_000_000)} MB` : `${Math.round(bytes / 1_000)} KB`;
}

export { EMAIL_PATTERN, PHONE_PATTERN };
