export const TOTAL_STEPS = 9;

export const applicationState = {
  community: null,
  currentStep: 1,
  sessionId: "",
  challenges: {},
  challengeAnswers: {
    math: "",
    date: ""
  },
  isSubmitting: false,
  isLoading: false,
  loadingMessage: "",
  applicationId: "",
  applicant: {
    firstName: "",
    lastName: "",
    email: "",
    phone: ""
  },
  communityCenter: {
    address: "",
    state: "",
    zip: ""
  },
  application: {
    letter: "",
    volunteeringExperience: "",
    referral: ""
  },
  agreements: {},
  verification: {
    mathCompleted: false,
    dateCompleted: false,
    uploadsCompleted: {}
  },
  uploads: {
    experience: null,
    animals: {}
  },
  errors: {}
};

export function updateNestedState(path, value) {
  const keys = path.split(".");
  const finalKey = keys.pop();
  const target = keys.reduce((current, key) => current[key], applicationState);
  target[finalKey] = value;
}

export function clearErrors() {
  applicationState.errors = {};
}

export function setErrors(errors) {
  applicationState.errors = errors;
}

export function resetChallengeError() {
  delete applicationState.errors.challenge;
  delete applicationState.errors.form;
}
