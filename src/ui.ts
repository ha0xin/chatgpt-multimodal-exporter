import { render, h } from 'preact';
import { isHostOK } from './utils';
import './style.css';
import { FloatingEntry } from './ui/components/FloatingEntry';
import { Toaster } from './ui/components/Toaster';

export function mountUI() {
  if (!isHostOK()) return;

  // Mount Toaster independently to document.body
  const toasterRoot = document.createElement('div');
  document.body.appendChild(toasterRoot);
  render(h(Toaster, null), toasterRoot);

  const mountFloatingEntry = () => {
    if (document.querySelector('.cgptx-mini-wrap')) return;
    const sidebarHeader = document.querySelector('#sidebar-header');
    
    if (sidebarHeader) {
      const root = document.createElement('div');
      
      // Try to find the collapse button wrapper to insert before it
      // Based on structure: [Logo] [MyUI] [CollapseWrapper]
      const closeBtn = sidebarHeader.querySelector('[data-testid="close-sidebar-button"]');
      // The button is wrapped in a div.flex, we need to insert before that div
      const targetContainer = closeBtn?.closest('div.flex'); 
      // Or just fallback to the last element if structure matches expectations (2 children initially)
      const insertTarget = (targetContainer && targetContainer.parentElement === sidebarHeader) 
        ? targetContainer 
        : null;

      if (insertTarget) {
          sidebarHeader.insertBefore(root, insertTarget);
      } else {
          // Fallback
          sidebarHeader.appendChild(root);
      }
      
      render(h(FloatingEntry, null), root);
    }
  };

  // Check immediately
  mountFloatingEntry();

  // Poll for sidebar header presence (it might load dynamically)
  const intervalId = setInterval(() => {
    if (document.querySelector('.cgptx-mini-wrap')) {
      clearInterval(intervalId);
      return;
    }
    mountFloatingEntry();
  }, 1000);
}
