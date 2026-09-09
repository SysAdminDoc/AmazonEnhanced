function matchesExtensionManifest(actual, expected) {
  return actual?.manifest_version === 3
    && actual.homepage_url === expected.homepage_url
    && actual.version === expected.version
    && actual.background?.service_worker === expected.background?.service_worker
    && actual.action?.default_popup === expected.action?.default_popup;
}

module.exports = { matchesExtensionManifest };
