export const SENSITIVE_FIELD =
  /^(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|email|phone|ssn|name|full_name|address|ip|user_id)$/i;
// Match identifier fields without treating words such as "valid" or "grid" as IDs.
export const IDENTIFIER_FIELD = /(?:^|_)id$/i;
// Authorization decisions are public outcomes, not Authorization credentials.
export const AUTHORIZATION_DECISION =
  /^(allow|allowed|deny|denied|required_group_missing|group_requirement_not_met|insufficient_permissions)$/i;
export const PRIVATE_KEY =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g;
export const BEARER_TOKEN = /\bBearer\s+([\w.\-+/=]+)/gi;
export const SENSITIVE_ASSIGNMENT =
  /\b(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|authorization|cookie|full_name|name|address|ssn|phone)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
export const IDENTIFIER_ASSIGNMENT =
  /(^|[^\w])(["']?)((?:[\w.-]*_)?id)\2(\s*[=:]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[[A-Z_]+_\d+\]|[^\s,;{}\[\]]+)/gi;
export const EMAIL_ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export const IP_ADDRESS = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
export const API_CREDENTIAL = /\b(?:sk-[\w-]{8,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g;
export const SOCIAL_SECURITY_NUMBER = /\b\d{3}-\d{2}-\d{4}\b/g;
export const PLACEHOLDER = /^\[[A-Z_]+_\d+\]$/;
export const PLACEHOLDER_SEGMENTS = /(\[[A-Z_]+_\d+\])/g;
export const PLACEHOLDER_OCCURRENCES = /\[[A-Z_]+_\d+\]/g;
