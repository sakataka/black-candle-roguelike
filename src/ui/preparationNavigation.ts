/** 支度の画面切り替え。選択や遠征の状態は既存の処理に任せる。 */
export function installPreparationNavigation(root: HTMLElement): () => void {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-prepare-page]")];
  const sections = [...root.querySelectorAll<HTMLElement>("[data-prepare-section]")];
  let activePage = "delver";

  function refresh(): void {
    root.dataset.currentPreparePage = activePage;
    for (const button of buttons) {
      const selected = button.dataset.preparePage === activePage;
      button.setAttribute("aria-pressed", String(selected));
      button.classList.toggle("is-active", selected);
    }
    for (const section of sections) section.hidden = section.dataset.prepareSection !== activePage;
    const main = root.querySelector<HTMLElement>(".prepare-main");
    if (main) main.hidden = activePage === "institute";
    const brief = root.querySelector<HTMLElement>(".prepare-brief");
    if (brief) brief.hidden = activePage === "institute";
    const mission = root.querySelector(".mission-option.is-selected");
    for (const [target, source] of [
      ["#prepare-mission-name", "strong"],
      ["#prepare-mission-target", "em"],
      ["#prepare-mission-reward", ".mission-reward"],
    ]) {
      const element = root.querySelector(target);
      if (element) element.textContent = mission?.querySelector(source)?.textContent?.replace(/^◆\s*/, "") ?? "任務を選んでください";
    }
  }

  for (const button of buttons) button.addEventListener("click", () => {
    activePage = button.dataset.preparePage ?? "delver";
    refresh();
    root.scrollTop = 0;
  });
  root.querySelector("#prepare-edit-mission")?.addEventListener("click", () => {
    activePage = "mission";
    refresh();
    buttons.find((button) => button.dataset.preparePage === activePage)?.focus();
    root.scrollTop = 0;
  });
  refresh();
  return refresh;
}
