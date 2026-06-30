export function injectOnce(id: string, css: string): void {
  if (typeof document === "undefined") return
  if (document.getElementById(id)) return
  const el = document.createElement("style")
  el.id = id
  el.textContent = css
  document.head.appendChild(el)
}
