import { LiquidGlass } from '../src';

for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-glass]'))) {
  const options = JSON.parse(el.dataset.glass ?? '{}') as ConstructorParameters<typeof LiquidGlass>[1];
  new LiquidGlass(el, options);
}
