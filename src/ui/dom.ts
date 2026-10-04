export function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

export function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** 単引用符を使う属性にも埋め込めるHTML文字列。 */
export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
