export const requiredElement = <T extends Element>(
  selector: string,
  root: ParentNode = document,
): T => {
  const element = root.querySelector<T>(selector);
  if (!element)
    throw new Error(`Не найден обязательный элемент страницы: ${selector}`);
  return element;
};

export const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};
