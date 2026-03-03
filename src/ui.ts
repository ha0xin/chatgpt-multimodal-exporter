import { render, h } from 'preact';
import { isHostOK } from './utils';
import './style.css';
import { FloatingEntry } from './ui/components/FloatingEntry';
import { Toaster } from './ui/components/Toaster';

const TOASTER_ROOT_ID = 'cgptx-toaster-root';
const SIDEBAR_ROOT_ID = 'cgptx-sidebar-root';
const COLLAPSED_ANCHOR_CLASS = 'cgptx-status-anchor';

let sidebarObserver: MutationObserver | null = null;
let collapsedAnchor: HTMLElement | null = null;
let sidebarPollTimer: number | null = null;

function isVisible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  return el.getClientRects().length > 0;
}

function setCollapsedAnchor(el: HTMLElement | null) {
  if (collapsedAnchor && collapsedAnchor !== el) {
    collapsedAnchor.classList.remove(COLLAPSED_ANCHOR_CLASS);
  }
  collapsedAnchor = el;
  if (collapsedAnchor) {
    collapsedAnchor.classList.add(COLLAPSED_ANCHOR_CLASS);
  }
}

function findOpenSidebarButton(): HTMLElement | null {
  const byTestId = document.querySelector('[data-testid="open-sidebar-button"]');
  if (isVisible(byTestId)) return byTestId;

  const btns = Array.from(document.querySelectorAll('button'));
  const found = btns.find((b) => {
    const label = `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`.toLowerCase();
    return (label.includes('open sidebar') || label.includes('打开边栏')) && isVisible(b);
  });
  return (found as HTMLElement) || null;
}

function ensureToasterMounted() {
  if (document.getElementById(TOASTER_ROOT_ID)) return;
  const toasterRoot = document.createElement('div');
  toasterRoot.id = TOASTER_ROOT_ID;
  document.body.appendChild(toasterRoot);
  render(h(Toaster, null), toasterRoot);
}

function mountFloatingEntry() {
  const sidebarHeader = document.querySelector('#sidebar-header');
  const closeSidebarBtn = sidebarHeader?.querySelector('[data-testid="close-sidebar-button"]') as HTMLElement | null;
  const isExpanded = !!(sidebarHeader && isVisible(closeSidebarBtn));
  const openSidebarBtn = findOpenSidebarButton();
  const existingRoot = document.getElementById(SIDEBAR_ROOT_ID);

  if (!isExpanded && !openSidebarBtn) {
    if (existingRoot) {
      existingRoot.remove();
    }
    setCollapsedAnchor(null);
    return;
  }

  const mode = isExpanded ? 'expanded' : 'collapsed';
  const mountParent = (mode === 'expanded'
    ? sidebarHeader
    : (openSidebarBtn?.parentElement || openSidebarBtn)) as HTMLElement;

  if (mode === 'collapsed') {
    setCollapsedAnchor(mountParent);
  } else {
    setCollapsedAnchor(null);
  }

  if (
    existingRoot &&
    existingRoot.parentElement === mountParent &&
    existingRoot.getAttribute('data-mode') === mode
  ) {
    return;
  }

  if (existingRoot) {
    existingRoot.remove();
  }

  const root = document.createElement('div');
  root.id = SIDEBAR_ROOT_ID;
  root.setAttribute('data-mode', mode);

  if (mode === 'expanded' && sidebarHeader) {
    const targetContainer = closeSidebarBtn?.closest('div.flex');
    const insertTarget = targetContainer && targetContainer.parentElement === sidebarHeader
      ? targetContainer
      : null;

    if (insertTarget) {
      sidebarHeader.insertBefore(root, insertTarget);
    } else {
      sidebarHeader.appendChild(root);
    }
    render(h(FloatingEntry, { collapsed: false }), root);
    return;
  }

  mountParent.appendChild(root);
  render(h(FloatingEntry, { collapsed: true }), root);
}

export function mountUI() {
  if (!isHostOK()) return;

  ensureToasterMounted();
  mountFloatingEntry();

  if (sidebarObserver) return;
  sidebarObserver = new MutationObserver(() => {
    mountFloatingEntry();
  });
  sidebarObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  if (sidebarPollTimer === null) {
    sidebarPollTimer = window.setInterval(() => {
      mountFloatingEntry();
    }, 250);
  }
}
