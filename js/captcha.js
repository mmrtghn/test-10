const API_BASE = "";

async function parseResponse(response) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) { const error = new Error(payload.message || "The server could not complete that request."); error.fields = payload.fields || {}; throw error; }
  return payload;
}

export async function submitApplication({ communityId, state }) {
  const formData = new FormData();
  formData.append("communityId", communityId);
  formData.append("application", JSON.stringify({ applicant: state.applicant, communityCenter: state.communityCenter, application: state.application, agreements: state.agreements }));
  if (state.uploads.experience) formData.append("experience", state.uploads.experience, state.uploads.experience.name);
  for (const [animalId, file] of Object.entries(state.uploads.animals)) if (file) formData.append(`animal_${animalId}`, file, file.name);
  return parseResponse(await fetch(`${API_BASE}/api/application`, { method: "POST", body: formData, headers: { Accept: "application/json" } }));
}
