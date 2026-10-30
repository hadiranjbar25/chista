export type CliAgent = 'claude' | 'codex';
export type ModelChoice = { id: string; label: string };
export type ModelCatalog = {
  options: ModelChoice[];
  loading: boolean;
  loaded: boolean;
  error: string;
};
export const emptyModelCatalog = (): ModelCatalog => ({
  options: [],
  loading: false,
  loaded: false,
  error: '',
});
export function validModelId(value: string) {
  return value.length <= 200 && !value.startsWith('-') && /^[a-zA-Z0-9_.:/@\[\]-]*$/.test(value);
}
