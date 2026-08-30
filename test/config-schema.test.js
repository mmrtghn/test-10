import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { renderStep } from "../js/ui.js";
import {
  CONFIG_SCHEMA_VERSION,
  createDefaultTemplate,
  composeCommunity,
  extractLegacyWebhook,
  migrateConfiguration,
  validateConfigDocument
} from "../lib/config-schema.js";

function documentWith(overrides = {}) {
  const templateId = "template-a";
  const communityId = "community-a";
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    communities: {
      [communityId]: {
        name: "Community A",
        logo: "assets/logos/harborview.svg",
        brandMark: "A",
        footer: "Applications are reviewed by the community team.",
        theme: { accent: "#14345B" },
        templateId,
        active: true,
        ...overrides.community
      }
    },
    templates: {
      [templateId]: createDefaultTemplate(),
      ...overrides.templates
    },
    ...overrides.document
  };
}

test("default template produces a valid canonical document", () => {
  assert.deepEqual(validateConfigDocument(documentWith()), []);
});

test("schema requires the live seven-step workflow", () => {
  const document = documentWith();
  delete document.templates["template-a"].steps.personal;
  document.templates["template-a"].steps.math = createDefaultTemplate().steps.personal;
  const errors = validateConfigDocument(document);
  assert.ok(errors.some(({ path }) => path === "templates.template-a.steps.personal"));
  assert.ok(errors.some(({ path }) => path === "templates.template-a.steps.math" || path === "templates.template-a.steps"));
});

test("unknown and secret keys are rejected", () => {
  const document = JSON.parse(JSON.stringify(documentWith()));
  document.webhook = "https://discord.com/api/webhooks/secret";
  document.templates["template-a"].captcha.mathIntro = "legacy";
  const errors = validateConfigDocument(document);
  assert.ok(errors.some(({ path }) => path === "webhook"));
  assert.ok(errors.some(({ path }) => path === "templates.template-a.captcha.mathIntro"));
});

test("prototype-pollution keys are rejected when they are own properties", () => {
  const document = JSON.parse(JSON.stringify(documentWith()));
  document.communities["community-a"].constructor = {};
  const errors = validateConfigDocument(document);
  assert.ok(errors.some(({ path }) => path === "communities.community-a.constructor"));
});

test("malformed review rows return validation errors instead of throwing", () => {
  const document = documentWith();
  document.templates["template-a"].reviewFields[0] = null;
  assert.doesNotThrow(() => validateConfigDocument(document));
  assert.ok(validateConfigDocument(document).some(({ code }) => code === "review.object"));
});

test("community template references must resolve", () => {
  const document = documentWith({ community: { templateId: "missing" } });
  assert.ok(validateConfigDocument(document).some(({ code }) => code === "template.reference"));
});

test("inactive communities do not compose for public use", () => {
  const document = documentWith({ community: { active: false } });
  assert.equal(composeCommunity(document, "community-a"), null);
});

test("composition uses route identity and excludes lifecycle data", () => {
  const document = documentWith();
  document.communities["community-a"].id = "spoofed";
  document.communities["community-a"].webhook = "secret";
  const composed = composeCommunity(document, "community-a");
  assert.equal(composed.id, "community-a");
  assert.equal(composed.active, undefined);
  assert.equal(composed.webhook, undefined);
  assert.equal(composed.steps.personal.title, "Tell us about yourself");
});

test("legacy seed migrates without dead step or captcha aliases", async () => {
  const seed = JSON.parse(await fs.readFile(new URL("../config/communities.json", import.meta.url), "utf8"));
  const migrated = migrateConfiguration(seed);
  assert.deepEqual(validateConfigDocument(migrated), []);
  const template = migrated.templates["community-a-template"];
  assert.deepEqual(Object.keys(template.steps), ["personal", "center", "story", "experience", "verification", "animals", "review"]);
  assert.equal("mathIntro" in template.captcha, false);
  assert.equal("math" in template.steps, false);
  assert.equal("success" in template.steps, false);
});

test("migration replaces the obsolete bundled logo path", () => {
  const template = documentWith().templates["template-a"];
  const legacy = {
    communities: {
      demo: {
        ...documentWith().communities["community-a"],
        logo: "assets/logos/community.svg",
        steps: {
          ...template.steps,
          success: template.completion.success,
          next: template.completion.next
        },
        form: template.form,
        instructions: template.instructions,
        captcha: template.captcha,
        animals: template.animals,
        allowedUploads: template.allowedUploads,
        reviewFields: template.reviewFields,
        buttons: template.buttons
      }
    }
  };
  assert.equal(migrateConfiguration(legacy).communities.demo.logo, "assets/logos/harborview.svg");
});

test("legacy upload limits are normalized with field-scoped warnings", () => {
  const template = createDefaultTemplate();
  const warnings = [];
  const legacy = {
    communities: {
      demo: {
        ...documentWith().communities["community-a"],
        steps: { ...template.steps, success: template.completion.success, next: template.completion.next, math: template.steps.personal },
        form: template.form,
        instructions: template.instructions,
        captcha: { ...template.captcha, dateIntro: "Retired copy" },
        animals: template.animals,
        allowedUploads: {
          application: { accept: ".PDF,.png,.exe", label: "Document", maxBytes: "3000000" },
          animal: { accept: ".JPG,.webp", label: "Animal", maxBytes: 3_000_000.8 }
        },
        reviewFields: template.reviewFields,
        buttons: template.buttons
      }
    }
  };
  const migrated = migrateConfiguration(legacy, { onWarning: (warning) => warnings.push(warning) });
  assert.deepEqual(validateConfigDocument(migrated), []);
  const uploads = migrated.templates["demo-template"].allowedUploads;
  assert.deepEqual(uploads.application, { accept: ".pdf,.png", label: "Document", maxBytes: 3_000_000 });
  assert.deepEqual(uploads.animal, { accept: ".jpg,.webp", label: "Animal", maxBytes: 3_000_000 });
  assert.ok(warnings.some(({ path, code }) => path === "communities.demo.allowedUploads.application.maxBytes" && code === "migration.upload-size"));
  assert.ok(warnings.some(({ path }) => path === "communities.demo.steps.math"));
  assert.ok(warnings.some(({ path }) => path === "communities.demo.captcha.dateIntro"));
});

test("legacy invalid upload limits fall back to the hard limit", () => {
  const template = createDefaultTemplate();
  const legacy = {
    communities: {
      demo: {
        ...documentWith().communities["community-a"],
        steps: { ...template.steps, success: template.completion.success, next: template.completion.next },
        form: template.form,
        instructions: template.instructions,
        captcha: template.captcha,
        animals: template.animals,
        allowedUploads: {
          application: { accept: ".exe", label: "", maxBytes: "not-a-number" },
          animal: { accept: ".png", label: "Animal", maxBytes: 9_000_000 }
        },
        reviewFields: template.reviewFields,
        buttons: template.buttons
      }
    }
  };
  const migrated = migrateConfiguration(legacy);
  const uploads = migrated.templates["demo-template"].allowedUploads;
  assert.equal(uploads.application.maxBytes, 3_000_000);
  assert.equal(uploads.animal.maxBytes, 3_000_000);
  assert.equal(uploads.application.accept, ".pdf,.png,.jpg,.jpeg,.webp");
});

test("legacy webhook extraction supports wrapped and direct community maps", () => {
  const wrapped = { communities: { demo: { webhook: "https://discord.com/api/webhooks/one" } } };
  const direct = { demo: { webhook: "https://discord.com/api/webhooks/one" } };
  assert.equal(extractLegacyWebhook(wrapped), "https://discord.com/api/webhooks/one");
  assert.equal(extractLegacyWebhook(direct), "https://discord.com/api/webhooks/one");
  assert.throws(() => extractLegacyWebhook({ communities: { one: { webhook: "one" }, two: { webhook: "two" } } }), /different webhooks/);
});

test("animal introduction is authoritative over generic Animals step copy", () => {
  const community = composeCommunity(documentWith(), "community-a");
  community.steps.animals.description = "Generic step description";
  community.captcha.animalIntro = "Applicant-facing animal introduction";
  const markup = renderStep(6, community, {
    isLoading: false,
    uploads: { animals: {} },
    errors: { animals: {} }
  });
  assert.match(markup, /Applicant-facing animal introduction/);
  assert.doesNotMatch(markup, /Generic step description/);
});
