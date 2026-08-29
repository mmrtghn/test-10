export async function loadCommunityConfiguration() {
  const communityId = new URLSearchParams(window.location.search).get("community");
  if (!communityId) throw new Error("No community was selected. Add a community=... parameter to the URL.");
  const response = await fetch(`/api/config?community=${encodeURIComponent(communityId)}`, { headers: { Accept: "application/json" } });
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.message || "The community configuration could not be loaded.");
  return payload.community;
}

export function getUploadSettings(community, type) {
  return community.allowedUploads?.[type] ?? { accept: ".png,.jpg,.jpeg,.webp,.pdf", label: "supported file", maxBytes: 8_000_000 };
}
