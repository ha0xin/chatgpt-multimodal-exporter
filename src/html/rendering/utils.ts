export const CDN_PREFIX = "https://cdn.oaistatic.com/";
export const DEFAULT_ROOT_ID = "client-created-root";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
