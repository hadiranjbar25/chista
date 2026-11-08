// Planning metadata only: every shipped capability remains available to everyone.
export const capabilityPlan = {
  Free: ['local-debugging', 'safety-controls', 'sanitized-export'],
  Pro: ['saved-investigations', 'redaction-profiles', 'telemetry-import'],
  Team: ['investigation-bundles', 'audit-history'],
} as const;
export const availableCapabilities = Object.values(capabilityPlan).flat();
