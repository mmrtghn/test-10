const API_BASE = "";

async function parseResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.message || "The server could not complete that request.");
    error.fields = payload.fields || {};
    throw error;
  }
  return payload;
}

export async function createSession(communityId) {
  const response = await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ communityId })
  });
  return parseResponse(response);
}

export async function issueChallenge(sessionId, type) {
  const response = await fetch(`${API_BASE}/api/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sessionId, type })
  });
  return parseResponse(response);
}

export async function verifyChallenge({ sessionId, type, challengeId, answer }) {
  const response = await fetch(`${API_BASE}/api/challenge/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sessionId, type, challengeId, answer })
  });
  return parseResponse(response);
}

export async function submitApplication({ sessionId, communityId, state }) {
  const formData = new FormData();
  formData.append("communityId", communityId);
  formData.append("application", JSON.stringify({
    applicant: state.applicant,
    communityCenter: state.communityCenter,
    application: state.application,
    agreements: state.agreements,
    verification: {
      mathCompleted: state.verification.mathCompleted,
      dateCompleted: state.verification.dateCompleted,
      mathAnswer: state.challengeAnswers.math,
      dateAnswer: state.challengeAnswers.date
    }
  }));

  if (state.uploads.experience) formData.append("experience", state.uploads.experience, state.uploads.experience.name);
  for (const [animalId, file] of Object.entries(state.uploads.animals)) {
    if (file) formData.append(`animal_${animalId}`, file, file.name);
  }

  const response = await fetch(`${API_BASE}/api/application`, {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json",
      "X-Application-Session": sessionId
    }
  });
  return parseResponse(response);
}
