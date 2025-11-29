// ==UserScript==
// @name         ChatGPT-Multimodal-Exporter
// @namespace    chatgpt-multimodal-exporter
// @version      0.3.0
// @description  导出对话 json + 会话中的多模态文件（图片、音频、sandbox 文件等）
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-end
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  // --- 小工具函数 -------------------------------------------------
  const U = {
    qs: (s, r = document) => r.querySelector(s),
    ce: (t, props = {}, attrs = {}) => {
      const el = document.createElement(t);
      Object.assign(el, props);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    },
    sanitize: (s) =>
      (s || "untitled").replace(/[\\/:*?\"<>|]+/g, "_").slice(0, 80),
    isInlinePointer: (p) => {
      if (!p) return false;
      const prefixes = [
        "https://cdn.oaistatic.com/",
        "https://oaidalleapiprodscus.blob.core.windows.net/",
      ];
      return prefixes.some((x) => p.startsWith(x));
    },
    pointerToFileId: (p) => {
      if (!p) return "";
      if (U.isInlinePointer(p)) return p; // already a CDN URL
      const m = p.match(/file[-_][0-9a-f]+/i);
      return m ? m[0] : p;
    },
    fileExtFromMime: (mime) => {
      if (!mime) return "";
      const map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "application/pdf": ".pdf",
        "text/plain": ".txt",
        "text/markdown": ".md",
      };
      if (map[mime]) return map[mime];
      if (mime.includes("/")) return "." + mime.split("/")[1];
      return "";
    },
    formatBytes: (n) => {
      if (!n || isNaN(n)) return "";
      const units = ["B", "KB", "MB", "GB"];
      let v = n;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${v.toFixed(v >= 10 || v % 1 === 0 ? 0 : 1)}${units[i]}`;
    },
    // 支持 /c/xxx 和 /g/yyy/c/xxx 两种路径
    convId: () => {
      const p = location.pathname;
      let m = p.match(/^\/c\/([0-9a-f-]+)$/i);
      if (m) return m[1];
      m = p.match(/^\/g\/[^/]+\/c\/([0-9a-f-]+)$/i);
      return m ? m[1] : "";
    },
    projectId: () => {
      const p = location.pathname;
      const m = p.match(/^\/g\/([^/]+)\/c\/[0-9a-f-]+$/i);
      return m ? m[1] : "";
    },
    isHostOK: () =>
      location.host.endsWith("chatgpt.com") ||
      location.host.endsWith("chat.openai.com"),
  };

  // --- 凭证模块：获取 accessToken / accountId ---------------------
  const Cred = (() => {
    let token = null;
    let accountId = null;
    let lastErr = "";

    const mask = (s, keepL = 8, keepR = 4) => {
      if (!s) return "";
      if (s.length <= keepL + keepR) return s;
      return `${s.slice(0, keepL)}…${s.slice(-keepR)}`;
    };

    const ensureViaSession = async (tries = 3) => {
      for (let i = 0; i < tries; i++) {
        try {
          const resp = await fetch("/api/auth/session", {
            credentials: "include",
          });
          if (!resp.ok) {
            lastErr = `session ${resp.status}`;
          } else {
            const j = await resp.json().catch(() => ({}));
            if (j && j.accessToken) {
              token = j.accessToken;
              lastErr = "";
            }
          }
          // 从 cookie 中拿 _account
          if (!accountId) {
            const m = document.cookie.match(
              /(?:^|;\s*)_account=([^;]+)/
            );
            if (m) accountId = decodeURIComponent(m[1]);
          }
          if (token) return true;
        } catch (e) {
          lastErr = e && e.message ? e.message : "session_error";
        }
        // 简单退避
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
      return !!token;
    };

    const getAuthHeaders = () => {
      const h = new Headers();
      if (token) h.set("authorization", `Bearer ${token}`);
      if (accountId) h.set("chatgpt-account-id", accountId);
      return h;
    };

    const debugText = () => {
      const tok = token ? mask(token) : "未获取";
      const acc = accountId || "未获取";
      const err = lastErr ? `\n错误：${lastErr}` : "";
      return `Token：${tok}\nAccount：${acc}${err}`;
    };

    return {
      ensureViaSession,
      getAuthHeaders,
      get token() {
        return token;
      },
      get accountId() {
        return accountId;
      },
      get debug() {
        return debugText();
      },
    };
  })();

  // --- 简单请求封装：拉当前会话 ----------------------------------
  async function fetchConversation(id, projectId) {
    if (!Cred.token) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("无法获取登录凭证（accessToken）");
    }

    const headers = Cred.getAuthHeaders();
    if (projectId) headers.set("chatgpt-project-id", projectId);

    const url = `${location.origin}/backend-api/conversation/${id}`;
    const init = {
      method: "GET",
      credentials: "include",
      headers,
    };

    let resp = await fetch(url, init).catch(() => null);
    if (!resp) throw new Error("网络错误");
    if (resp.status === 401) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("401：重新获取凭证失败");
      const h2 = Cred.getAuthHeaders();
      if (projectId) h2.set("chatgpt-project-id", projectId);
      init.headers = h2;
      resp = await fetch(url, init).catch(() => null);
      if (!resp) throw new Error("网络错误（重试）");
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 120)}`);
    }
    return resp.json();
  }

  // sandbox 下载（interpreter download）
  async function downloadSandboxFile({ conversationId, messageId, sandboxPath }) {
    if (!Cred.token) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("没有 accessToken，无法下载 sandbox 文件");
    }
    const headers = Cred.getAuthHeaders();
    const pid = U.projectId();
    if (pid) headers.set("chatgpt-project-id", pid);

    const params = new URLSearchParams({
      message_id: messageId,
      sandbox_path: sandboxPath.replace(/^sandbox:/, ""),
    });
    const url = `${location.origin}/backend-api/conversation/${conversationId}/interpreter/download?${params.toString()}`;
    const resp = await fetch(url, { headers, credentials: "include" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`sandbox download meta ${resp.status}: ${txt.slice(0, 120)}`);
    }
    let j;
    try {
      j = await resp.json();
    } catch (e) {
      throw new Error("sandbox download meta 非 JSON");
    }
    const dl = j.download_url;
    if (!dl) throw new Error("sandbox download_url 缺失");
    // 直接用 GM_download 避免 CORS
    const fname = U.sanitize(j.file_name || sandboxPath.split("/").pop() || "sandbox_file");
    await gmDownload(dl, fname);
  }

  // --- 文件下载助手 -----------------------------------------------
  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = U.ce("a", { href: url });
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    a.remove();
  }

  function saveJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json",
    });
    saveBlob(blob, filename);
  }

  // GM 下载（跨域不受 CORS 限制）
  function gmDownload(url, filename) {
    return new Promise((resolve, reject) => {
      GM_download({
        url,
        name: filename || "",
        onload: resolve,
        onerror: reject,
        ontimeout: reject,
      });
    });
  }

  // --- 解析会话中的文件/指针（全量） ------------------------------
  function collectFileCandidates(conv) {
    const mapping = (conv && conv.mapping) || {};
    const out = new Map(); // key -> info
    const convId = conv?.conversation_id || "";

    const add = (fileId, info) => {
      if (!fileId) return;
      if (out.has(fileId)) return;
      out.set(fileId, { file_id: fileId, conversation_id: convId, ...info });
    };

    for (const key in mapping) {
      const node = mapping[key];
      if (!node || !node.message) continue;
      const msg = node.message;
      const meta = msg.metadata || {};
      const c = msg.content || {};

      // attachments
      (meta.attachments || []).forEach((att) => {
        if (!att || !att.id) return;
        add(att.id, { source: "attachment", meta: att });
      });

      // content references by file
      const crefByFile = meta.content_references_by_file || {};
      Object.values(crefByFile)
        .flat()
        .forEach((ref) => {
          if (ref?.file_id) add(ref.file_id, { source: "cref", meta: ref, message_id: msg.id });
          if (ref?.asset_pointer) {
            const fid = U.pointerToFileId(ref.asset_pointer);
            add(fid, { source: "cref-pointer", pointer: ref.asset_pointer, meta: ref, message_id: msg.id });
          }
        });

      // n7jupd crefs
      const n7 = meta.n7jupd_crefs_by_file || meta.n7jupd_crefs || {};
      const n7list = Array.isArray(n7) ? n7 : Object.values(n7).flat();
      n7list.forEach((ref) => {
        if (ref?.file_id) add(ref.file_id, { source: "n7jupd-cref", meta: ref, message_id: msg.id });
      });

      // parts asset pointers
      if (Array.isArray(c.parts)) {
        c.parts.forEach((part) => {
          if (part && typeof part === "object" && part.content_type && part.asset_pointer) {
            const fid = U.pointerToFileId(part.asset_pointer);
            add(fid, { source: part.content_type, pointer: part.asset_pointer, meta: part, message_id: msg.id });
          }
          // voice: real_time_user_audio_video_asset_pointer 里嵌套 audio_asset_pointer
          if (
            part &&
            typeof part === "object" &&
            part.content_type === "real_time_user_audio_video_asset_pointer" &&
            part.audio_asset_pointer &&
            part.audio_asset_pointer.asset_pointer
          ) {
            const ap = part.audio_asset_pointer;
            const fid = U.pointerToFileId(ap.asset_pointer);
            add(fid, { source: "voice-audio", pointer: ap.asset_pointer, meta: ap, message_id: msg.id });
          }
          // 兼容 audio_asset_pointer 放在子字段（无 content_type）
          if (part && typeof part === "object" && part.audio_asset_pointer && part.audio_asset_pointer.asset_pointer) {
            const ap = part.audio_asset_pointer;
            const fid = U.pointerToFileId(ap.asset_pointer);
            add(fid, { source: "voice-audio", pointer: ap.asset_pointer, meta: ap, message_id: msg.id });
          }
        });
      }

      // inline placeholder {{file:...}} 和 sandbox: 链接
      if (c.content_type === "text" && Array.isArray(c.parts)) {
        c.parts.forEach((txt) => {
          if (typeof txt !== "string") return;
          const matches = txt.match(/\{\{file:([^}]+)\}\}/g) || [];
          matches.forEach((tok) => {
            const fid = tok.slice(7, -2);
            add(fid, { source: "inline-placeholder", message_id: msg.id });
          });
          const sandboxLinks = txt.match(/sandbox:[^\s\)\]]+/g) || [];
          sandboxLinks.forEach((s) => {
            add(s, { source: "sandbox-link", pointer: s, message_id: msg.id });
          });
        });
      }
    }
    return [...out.values()];
  }

  async function fetchFileMeta(fileId, headers) {
    const url = `${location.origin}/backend-api/files/${fileId}`;
    const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
    if (!resp.ok) throw new Error(`meta ${resp.status}`);
    return resp.json();
  }

  async function fetchDownloadUrlOrResponse(fileId, headers) {
    const url = `${location.origin}/backend-api/files/download/${fileId}?inline=false`;
    const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
    if (!resp.ok) throw new Error(`download meta ${resp.status}`);
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("json")) {
      const j = await resp.json();
      return j.download_url || j.url || null;
    }
    // Already binary stream
    return resp;
  }

  async function downloadPointerOrFile(fileInfo) {
    const fileId = fileInfo.file_id;
    const pointer = fileInfo.pointer || "";
    const convId = fileInfo.conversation_id || "";
    const messageId = fileInfo.message_id || "";

    // inline CDN
    if (U.isInlinePointer(fileId) || U.isInlinePointer(pointer)) {
      const url = U.isInlinePointer(pointer) ? pointer : fileId;
      const ext = U.fileExtFromMime("") || ".bin";
      const name =
        (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
        `${U.sanitize(fileId)}${ext}`;
      await gmDownload(url, name);
      return;
    }

    // sandbox pointer -> interpreter download
    if (pointer && pointer.startsWith("sandbox:")) {
      const convId = fileInfo.conversation_id || "";
      const messageId = fileInfo.message_id || "";
      if (!convId || !messageId) {
        console.warn("[ChatGPT-Multimodal-Exporter] sandbox pointer缺少 conversation/message id", pointer);
        return;
      }
      await downloadSandboxFile({ conversationId: convId, messageId, sandboxPath: pointer });
      return;
    }

    if (!Cred.token) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("没有 accessToken，无法下载文件");
    }
    const headers = Cred.getAuthHeaders();
    const pid = U.projectId();
    if (pid) headers.set("chatgpt-project-id", pid);

    // 直接用 download 接口（跳过 /files 元数据，避免 500）
    const downloadResult = await fetchDownloadUrlOrResponse(fileId, headers);
    let resp;
    if (downloadResult instanceof Response) {
      resp = downloadResult;
    } else if (typeof downloadResult === "string") {
      const fname =
        (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
        `${fileId}${U.fileExtFromMime("") || ""}`;
      await gmDownload(downloadResult, fname);
      return;
    } else {
      throw new Error("无法获取 download_url");
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`下载失败 ${resp.status}: ${txt.slice(0, 120)}`);
    }

    const blob = await resp.blob();
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
    const mime =
      (fileInfo.meta && fileInfo.meta.mime_type) ||
      (fileInfo.meta && fileInfo.meta.file_type) ||
      resp.headers.get("Content-Type") ||
      "";
    const ext = U.fileExtFromMime(mime) || ".bin";
    let name =
      (fileInfo.meta && fileInfo.meta.name) ||
      (fileInfo.meta && fileInfo.meta.file_name) ||
      (m && decodeURIComponent(m[1])) ||
      `${fileId}${ext}`;
    name = U.sanitize(name);
    saveBlob(blob, name);
  }

  async function downloadSelectedFiles(list) {
    let okCount = 0;
    for (const info of list) {
      try {
        await downloadPointerOrFile(info);
        okCount++;
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 下载失败", info, e);
      }
    }
    return { ok: okCount, total: list.length };
  }

  // --- 从会话 JSON 中抽取图片信息 --------------------------------
  function extractImages(conv) {
    const mapping = conv && conv.mapping ? conv.mapping : {};
    const images = [];
    const seen = new Set();

    for (const key in mapping) {
      const node = mapping[key];
      if (!node || !node.message) continue;
      const msg = node.message;
      const role = msg.author && msg.author.role;
      const msgId = msg.id;

      // 1) attachments 里的上传文件
      const meta = msg.metadata || {};
      if (Array.isArray(meta.attachments)) {
        for (const att of meta.attachments) {
          if (!att || !att.id) continue;
          const fileId = att.id;
          if (seen.has(fileId)) continue;
          seen.add(fileId);
          images.push({
            kind: "attachment",
            file_id: fileId,
            name: att.name || "",
            mime_type: att.mime_type || "",
            size_bytes: att.size || att.size_bytes || null,
            message_id: msgId,
            role,
            source: "upload",
          });
        }
      }

      // 2) multimodal_text 里的 image_asset_pointer
      const c = msg.content;
      if (c && c.content_type === "multimodal_text" && Array.isArray(c.parts)) {
        for (const part of c.parts) {
          if (
            part &&
            typeof part === "object" &&
            part.content_type === "image_asset_pointer"
          ) {
            const pointer = part.asset_pointer || "";
            // 例：sediment://file_00000000f3e0722faa377d4dc34147b5
            let fileId = "";
            const m = pointer.match(/file_[0-9a-f]+/i);
            if (m) fileId = m[0];

            // 去重：按 file_id / pointer
            const keyId = fileId || pointer;
            if (seen.has(keyId)) continue;
            seen.add(keyId);

            images.push({
              kind: "asset_pointer",
              file_id: fileId,
              pointer,
              width: part.width,
              height: part.height,
              size_bytes: part.size_bytes,
              message_id: msgId,
              role,
              source: "asset_pointer",
            });
          }
        }
      }
    }

    console.log(
      "[ChatGPT-Multimodal-Exporter] 找到的图片信息：",
      images
    );
    return images;
  }

  // --- 预览/选择弹窗 ---------------------------------------------
  function showFilePreviewDialog(candidates, onConfirm) {
    const overlay = U.ce("div", { className: "cgptx-modal" });
    const box = U.ce("div", { className: "cgptx-modal-box" });

    const header = U.ce("div", { className: "cgptx-modal-header" });
    const title = U.ce("div", {
      className: "cgptx-modal-title",
      textContent: `可下载文件 (${candidates.length})`,
    });
    const actions = U.ce("div", { className: "cgptx-modal-actions" });

    const btnClose = U.ce("button", {
      className: "cgptx-btn",
      textContent: "关闭",
    });
    const btnDownload = U.ce("button", {
      className: "cgptx-btn primary",
      textContent: "下载选中",
    });
    const btnSelectAll = U.ce("button", {
      className: "cgptx-btn",
      textContent: "全选/反选",
    });

    actions.append(btnSelectAll, btnDownload, btnClose);
    header.append(title, actions);

    const listEl = U.ce("div", { className: "cgptx-list" });

    const items = candidates.map((info, idx) => {
      const row = U.ce("div", { className: "cgptx-item" });
      const checkbox = U.ce("input", {
        type: "checkbox",
        checked: true,
        "data-idx": idx,
      });
      const body = U.ce("div");
      const name =
        (info.meta && (info.meta.name || info.meta.file_name)) ||
        info.file_id ||
        info.pointer ||
        "未命名";
      const titleEl = U.ce("div", { className: "title", textContent: name });
      const metaParts = [];
      metaParts.push(`来源: ${info.source || "未知"}`);
      if (info.file_id) metaParts.push(`file_id: ${info.file_id}`);
      if (info.pointer && info.pointer !== info.file_id) metaParts.push(`pointer: ${info.pointer}`);
      const mime =
        (info.meta && (info.meta.mime_type || info.meta.file_type)) ||
        (info.meta && info.meta.mime) ||
        "";
      if (mime) metaParts.push(`mime: ${mime}`);
      const size =
        info.meta?.size_bytes ||
        info.meta?.size ||
        info.meta?.file_size ||
        info.meta?.file_size_bytes ||
        null;
      if (size) metaParts.push(`大小: ${U.formatBytes(size)}`);
      const metaEl = U.ce("div", { className: "meta", textContent: metaParts.join(" • ") });

      body.append(titleEl, metaEl);
      row.append(checkbox, body);
      listEl.append(row);
      return { row, checkbox, info };
    });

    const footer = U.ce("div", {
      className: "cgptx-modal-actions",
      style: "justify-content:flex-end;",
    });
    const tip = U.ce("div", {
      className: "cgptx-chip",
      textContent: "点击“下载选中”将按列表顺序依次下载（含 /files 和 CDN 指针）",
    });
    footer.append(tip);

    box.append(header, listEl, footer);
    overlay.append(box);
    document.body.append(overlay);

    const close = () => overlay.remove();

    btnClose.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    btnSelectAll.addEventListener("click", () => {
      const allChecked = items.every((i) => i.checkbox.checked);
      items.forEach((i) => (i.checkbox.checked = !allChecked));
    });
    btnDownload.addEventListener("click", () => {
      const selected = items.filter((i) => i.checkbox.checked).map((i) => i.info);
      if (!selected.length) {
        alert("请至少选择一个文件");
        return;
      }
      close();
      onConfirm(selected);
    });
  }

  // --- 简易 UI：右下角两个按钮 + 凭证状态 ------------------------
  let lastConvData = null; // 缓存最近一次拉取的会话 JSON

  function mountUI() {
    if (!U.isHostOK()) return;
    if (U.qs("#cgptx-mini-btn")) return;

    const style = U.ce("style", {
      textContent: `
      .cgptx-mini-wrap {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cgptx-mini-badge {
        font-size: 11px;
        padding: 3px 6px;
        border-radius: 999px;
        background: #f3f4f6;
        color: #374151;
        border: 1px solid #e5e7eb;
        max-width: 260px;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
      .cgptx-mini-badge.ok {
        background: #e8f7ee;
        border-color: #b7e3c9;
        color: #065f46;
      }
      .cgptx-mini-badge.bad {
        background: #fef2f2;
        border-color: #fecaca;
        color: #b91c1c;
      }
      .cgptx-mini-btn-row {
        display: flex;
        gap: 6px;
      }
      .cgptx-mini-btn {
        width: 46px;
        height: 46px;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        background: #111827;
        color: #fff;
        box-shadow: 0 8px 22px rgba(0, 0, 0, .22);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: transform .15s, opacity .15s;
        opacity: .95;
      }
      .cgptx-mini-btn:hover {
        transform: translateY(-1px);
        opacity: 1;
      }
      .cgptx-mini-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
        transform: none;
      }
      .cgptx-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.35);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
      }
      .cgptx-modal-box {
        width: min(840px, 94vw);
        max-height: 80vh;
        background: #111827;
        color: #e5e7eb;
        border: 1px solid #1f2937;
        border-radius: 14px;
        box-shadow: 0 20px 40px rgba(0,0,0,.35);
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: hidden;
        font-size: 14px;
      }
      .cgptx-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .cgptx-modal-title {
        font-weight: 600;
        font-size: 16px;
      }
      .cgptx-modal-actions {
        display: flex;
        gap: 8px;
      }
      .cgptx-chip {
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #1f2937;
        background: #0b1220;
        color: #9ca3af;
      }
      .cgptx-list {
        flex: 1;
        overflow: auto;
        border: 1px solid #1f2937;
        border-radius: 10px;
        background: #0b1220;
      }
      .cgptx-item {
        display: grid;
        grid-template-columns: 26px 1fr;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid #1f2937;
        align-items: start;
      }
      .cgptx-item:last-child {
        border-bottom: none;
      }
      .cgptx-item .title {
        font-weight: 600;
        color: #f3f4f6;
      }
      .cgptx-item .meta {
        color: #9ca3af;
        font-size: 12px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .cgptx-btn {
        border: 1px solid #1f2937;
        background: #111827;
        color: #e5e7eb;
        padding: 8px 12px;
        border-radius: 10px;
        cursor: pointer;
      }
      .cgptx-btn.primary {
        background: #2563eb;
        border-color: #1d4ed8;
        color: white;
      }
      .cgptx-btn:disabled {
        opacity: .5;
        cursor: not-allowed;
      }
    `,
    });
    document.head.appendChild(style);

    const wrap = U.ce("div", { className: "cgptx-mini-wrap" });

    const badge = U.ce("div", {
      className: "cgptx-mini-badge bad",
      id: "cgptx-mini-badge",
      textContent: "凭证: 未检测",
      title: "尚未尝试获取凭证",
    });

    const row = U.ce("div", { className: "cgptx-mini-btn-row" });

    // JSON 导出按钮
    const btnJson = U.ce("button", {
      id: "cgptx-mini-btn",
      className: "cgptx-mini-btn",
      title: "导出当前对话 JSON",
      textContent: "⬇︎",
    });

    // 文件下载按钮（全量）
    const btnFiles = U.ce("button", {
      id: "cgptx-mini-btn-files",
      className: "cgptx-mini-btn",
      title: "下载当前对话中可识别的文件/指针",
      textContent: "📦",
    });

    row.append(btnJson, btnFiles);
    wrap.append(badge, row);
    document.body.appendChild(wrap);

    // 更新凭证状态
    async function refreshCredStatus() {
      await Cred.ensureViaSession();
      const hasToken = !!Cred.token;
      const hasAcc = !!Cred.accountId;
      badge.textContent = `Token: ${hasToken ? "✔" : "✖"} / Account: ${
        hasAcc ? "✔" : "✖"
      }`;
      badge.title = Cred.debug;
      badge.classList.remove("ok", "bad");
      badge.classList.add(hasToken && hasAcc ? "ok" : "bad");
    }

    // 首次尝试获取凭证
    refreshCredStatus();
    // 周期性轻量刷新
    setInterval(refreshCredStatus, 60 * 1000);

    // 导出 JSON 按钮
    btnJson.addEventListener("click", async () => {
      const id = U.convId();
      const pid = U.projectId();
      if (!id) {
        alert("未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。");
        return;
      }

      btnJson.disabled = true;
      btnJson.title = "导出中…";

      try {
        await refreshCredStatus();
        if (!Cred.token) throw new Error("没有有效的 accessToken");

        const data = await fetchConversation(id, pid || undefined);
        lastConvData = data;

        // 拿到所有图片 pointer / file_id，并打印到控制台
        extractImages(data);

        const title = U.sanitize(data?.title || "");
        const filename = `${title || "chat"}_${id}.json`;
        saveJSON(data, filename);
        btnJson.title = "导出完成 ✅（点击可重新导出）";
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 导出失败：", e);
        alert("导出失败: " + (e && e.message ? e.message : e));
        btnJson.title = "导出失败 ❌（点击重试）";
      } finally {
        btnJson.disabled = false;
      }
    });

    // 下载图片按钮
// 下载所有可识别文件按钮
    btnFiles.addEventListener("click", async () => {
      const id = U.convId();
      const pid = U.projectId();
      if (!id) {
        alert("未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。");
        return;
      }

      btnFiles.disabled = true;
      btnFiles.title = "下载文件中…";

      try {
        await refreshCredStatus();
        if (!Cred.token) throw new Error("没有有效的 accessToken");

        let data = lastConvData;
        if (!data || data.conversation_id !== id) {
          data = await fetchConversation(id, pid || undefined);
          lastConvData = data;
        }

        const cands = collectFileCandidates(data);
        if (!cands.length) {
          alert("未找到可下载的文件/指针。");
          btnFiles.title = "未找到文件";
          return;
        }
        showFilePreviewDialog(cands, async (selected) => {
          btnFiles.disabled = true;
          btnFiles.title = `下载中 (${selected.length})…`;
          const res = await downloadSelectedFiles(selected);
          btnFiles.title = `完成 ${res.ok}/${res.total}（可再次点击）`;
          btnFiles.disabled = false;
          alert(`文件下载完成，成功 ${res.ok}/${res.total}，详情见控制台。`);
        });
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 下载文件失败：", e);
        alert("下载文件失败: " + (e && e.message ? e.message : e));
        btnFiles.title = "下载文件失败（点击重试）";
      } finally {
        btnFiles.disabled = false;
      }
    });
  }

  // --- 启动 -------------------------------------------------------
  function boot() {
    if (!U.isHostOK()) return;
    if (document.readyState === "complete" || document.readyState === "interactive") {
      mountUI();
    } else {
      document.addEventListener("DOMContentLoaded", mountUI);
    }
  }

  boot();
})();
