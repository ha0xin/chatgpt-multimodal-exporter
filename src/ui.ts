import { render, h } from 'preact';
import { U } from './utils';
import './style.css';
import { FloatingEntry } from './ui/components/FloatingEntry';

export function mountUI() {
  if (!U.isHostOK()) return;
  if (U.qs('.cgptx-mini-wrap')) return;

  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(FloatingEntry, null), root);
}
