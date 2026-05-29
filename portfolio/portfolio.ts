import { LiquidGlass, LiquidInteractive } from '../src';
import type { LiquidGlassOptions } from '../src';

/**
 * 포트폴리오 부트스트랩.
 * - [data-glass] 요소마다 굴절 글래스 엔진을 붙이고
 * - .lg-interactive 요소에 3D 틸트 / 글레어 / 젤리 인터랙션을 연결하며
 * - 스크롤 등장 애니메이션과 네비게이션 활성 표시를 처리합니다.
 */

// === 1. 글래스 엔진 부착 ===
const instances = new Map<HTMLElement, LiquidGlass>();
for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-glass]'))) {
  let config: LiquidGlassOptions = {};
  try {
    config = JSON.parse(el.dataset.glass ?? '{}') as LiquidGlassOptions;
  } catch (e) {
    console.warn('잘못된 data-glass JSON:', el, e);
  }
  instances.set(el, new LiquidGlass(el, config));
}

// === 2. 인터랙티브(틸트/글레어/젤리) 부착 ===
for (const el of Array.from(document.querySelectorAll<HTMLElement>('.lg-interactive'))) {
  new LiquidInteractive(el);
}

// === 3. 스크롤 등장 애니메이션 ===
const revealEls = Array.from(document.querySelectorAll<HTMLElement>('.lg-reveal'));
if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('is-visible'));
}

// === 4. 네비게이션 활성 섹션 표시 ===
const navLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>('.nav-links a')
);
const linkById = new Map(
  navLinks.map((a) => [a.getAttribute('href')?.slice(1) ?? '', a])
);
const sections = Array.from(document.querySelectorAll<HTMLElement>('main section[id]'));

if ('IntersectionObserver' in window && sections.length) {
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const link = linkById.get(entry.target.id);
        if (!link) continue;
        navLinks.forEach((a) => a.classList.remove('active'));
        link.classList.add('active');
      }
    },
    { rootMargin: '-45% 0px -50% 0px' }
  );
  sections.forEach((s) => spy.observe(s));
}

// === 5. 푸터 연도 ===
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());
