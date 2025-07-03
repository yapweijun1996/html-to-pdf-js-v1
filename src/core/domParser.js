export function cloneDom(element) {
  if (!element) {
    throw new Error('No element provided');
  }
  return element.cloneNode(true);
}
