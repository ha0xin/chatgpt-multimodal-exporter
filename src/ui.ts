import { render, h } from 'preact';
import { U } from './utils';
import { injectStyles } from './ui/styles';
import { FloatingEntry } from './ui/components/FloatingEntry';

export function mountUI() {
  if (!U.isHostOK()) return;
  if (U.qs('.cgptx-mini-wrap')) return;

  injectStyles();

  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(FloatingEntry, null), root);
}
