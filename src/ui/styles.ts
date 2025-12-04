import { U } from '../utils';

export function injectStyles() {
    const style = U.ce('style', {
        textContent: `
      .cgptx-mini-wrap {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cgptx-mini-badge {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #ffffff;
        color: #374151;
        border: 1px solid #e5e7eb;
        max-width: 260px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        box-shadow: 0 2px 5px rgba(0,0,0,0.05);
      }
      .cgptx-mini-badge.ok {
        background: #ecfdf5;
        border-color: #a7f3d0;
        color: #047857;
      }
      .cgptx-mini-badge.bad {
        background: #fef2f2;
        border-color: #fecaca;
        color: #b91c1c;
      }
      .cgptx-mini-btn-row {
        display: flex;
        gap: 8px;
      }
      .cgptx-mini-btn {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 1px solid #e5e7eb;
        cursor: pointer;
        background: #ffffff;
        color: #4b5563;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        transition: all .2s ease;
      }
      .cgptx-mini-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
        color: #2563eb;
        border-color: #bfdbfe;
      }
      .cgptx-mini-btn:disabled {
        opacity: .6;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }
      .cgptx-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
      }
      .cgptx-modal-box {
        width: min(840px, 94vw);
        max-height: 85vh;
        background: #ffffff;
        color: #1f2937;
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.1);
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        overflow: hidden;
        font-size: 14px;
      }
      .cgptx-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid #f3f4f6;
      }
      .cgptx-modal-title {
        font-weight: 700;
        font-size: 18px;
        color: #111827;
      }
      .cgptx-modal-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .cgptx-chip {
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        color: #4b5563;
        font-size: 13px;
      }
      .cgptx-list {
        flex: 1;
        overflow: auto;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        background: #f9fafb;
      }
      .cgptx-item {
        display: grid;
        grid-template-columns: 24px 20px 1fr;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid #e5e7eb;
        align-items: center;
        background: #fff;
        transition: background .15s;
      }
      .cgptx-item:hover {
        background: #f3f4f6;
      }
      .cgptx-item:last-child {
        border-bottom: none;
      }
      .cgptx-item .title {
        font-weight: 500;
        color: #1f2937;
        line-height: 1.4;
      }
      .cgptx-group {
        border-bottom: 1px solid #e5e7eb;
        background: #fff;
      }
      .cgptx-group:last-child {
        border-bottom: none;
      }
      .cgptx-group-header {
        display: grid;
        grid-template-columns: 24px 20px 1fr auto;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #f3f4f6;
        cursor: pointer;
        user-select: none;
      }
      .cgptx-group-header:hover {
        background: #e5e7eb;
      }
      .cgptx-group-list {
        border-top: 1px solid #e5e7eb;
      }
      .cgptx-arrow {
        font-size: 12px;
        color: #6b7280;
        transition: transform .2s;
      }
      .group-title {
        font-weight: 600;
        color: #374151;
      }
      .group-count {
        color: #6b7280;
        font-size: 12px;
        background: #e5e7eb;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .cgptx-item .meta {
        color: #6b7280;
        font-size: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .cgptx-btn {
        border: 1px solid #d1d5db;
        background: #ffffff;
        color: #374151;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 500;
        transition: all .15s;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .cgptx-btn:hover {
        background: #f9fafb;
        border-color: #9ca3af;
        color: #111827;
      }
      .cgptx-btn.primary {
        background: #3b82f6;
        border-color: #2563eb;
        color: white;
        box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
      }
      .cgptx-btn.primary:hover {
        background: #2563eb;
      }
      .cgptx-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
        box-shadow: none;
      }
      /* Progress Bar */
      .cgptx-progress-wrap {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
      }
      .cgptx-progress-track {
        height: 8px;
        background: #e5e7eb;
        border-radius: 4px;
        overflow: hidden;
      }
      .cgptx-progress-bar {
        height: 100%;
        background: #3b82f6;
        width: 0%;
        transition: width 0.3s ease;
      }
      .cgptx-progress-text {
        font-size: 12px;
        color: #6b7280;
        text-align: right;
      }
      
      /* Checkbox enhancement */
      input[type="checkbox"] {
        accent-color: #3b82f6;
        width: 16px;
        height: 16px;
        cursor: pointer;
      }
    `,
    });
    document.head.appendChild(style);
}
