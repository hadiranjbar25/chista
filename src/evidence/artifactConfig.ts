export const SUPPORTED_FORMATS: readonly string[] = ['csv', 'tsv', 'json', 'log', 'txt'];
export const ARTIFACT_FILE_ACCEPT = SUPPORTED_FORMATS.map((format) => `.${format}`).join(',');
export const MAX_ARTIFACTS = 20;
export const MAX_ARTIFACT_BYTES = 2_000_000;
