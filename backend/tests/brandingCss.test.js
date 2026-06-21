const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLogtoOrganizationBrandingCss, normalizeHexColor, normalizeCssUrl } = require("../services/brandingCss");

test("buildLogtoOrganizationBrandingCss generates light and dark Logto CSS from branding assets", () => {
  const result = buildLogtoOrganizationBrandingCss({
    lightLogoUrl: "https://cdn.example/logo.png",
    lightFaviconUrl: "https://cdn.example/favicon.ico",
    lightPrimaryColor: "#ABC",
    darkLogoUrl: "https://cdn.example/logo-dark.png",
    darkFaviconUrl: "https://cdn.example/favicon-dark.ico",
    darkPrimaryColor: "#123456",
  });

  assert.equal(result.normalized.lightPrimaryColor, "#aabbcc");
  assert.match(result.css, /--civitas-brand-primary: #aabbcc/);
  assert.match(result.css, /prefers-color-scheme: dark/);
  assert.match(result.css, /logo-dark\.png/);
  assert.match(result.css, /favicon-dark\.ico/);
});

test("branding css normalizers reject unsafe values", () => {
  assert.equal(normalizeHexColor("javascript:red"), null);
  assert.equal(normalizeCssUrl("javascript:alert(1)"), null);
});
