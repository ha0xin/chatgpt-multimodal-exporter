import { render, h, Fragment } from 'preact';
import { isHostOK } from './utils';
import './style.css';
import { FloatingEntry } from './ui/components/FloatingEntry';
import { Toaster } from './ui/components/Toaster';

export function mountUI() {
  if (!isHostOK()) return;
  if (document.querySelector('.cgptx-mini-wrap')) return;

  const root = document.createElement('div');
  document.body.appendChild(root);
  render(
    h(Fragment, null,
      h(FloatingEntry, null),
      h(Toaster, null)
    ),
    root
  );
}
