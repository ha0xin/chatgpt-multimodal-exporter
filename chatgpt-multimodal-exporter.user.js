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
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
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
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
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

  const BATCH_CONCURRENCY = 4;
  const LIST_PAGE_SIZE = 50;

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

  async function downloadSandboxFileBlob({ conversationId, messageId, sandboxPath }) {
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
    const fname = U.sanitize(j.file_name || sandboxPath.split("/").pop() || "sandbox_file");
    const gmHeaders = {};
    const res = await gmFetchBlob(dl, gmHeaders);
    return { blob: res.blob, mime: res.mime || "", filename: fname };
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

  function parseMimeFromHeaders(raw) {
    if (!raw) return "";
    const m = raw.match(/content-type:\s*([^\r\n;]+)/i);
    return m ? m[1].trim() : "";
  }

  // 跨域抓取二进制为 Blob（用于 ZIP 打包）
  function gmFetchBlob(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        method: "GET",
        headers: headers || {},
        responseType: "arraybuffer",
        onload: (res) => {
          const mime = parseMimeFromHeaders(res.responseHeaders || "") || "";
          const buf = res.response || res.responseText;
          resolve({ blob: new Blob([buf], { type: mime }), mime });
        },
        onerror: (err) => reject(new Error(err && err.error ? err.error : "gm_fetch_error")),
        ontimeout: () => reject(new Error("gm_fetch_timeout")),
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

  // 批量场景：返回 Blob 以便 ZIP 打包
  async function downloadPointerOrFileAsBlob(fileInfo) {
    const fileId = fileInfo.file_id;
    const pointer = fileInfo.pointer || "";
    const convId = fileInfo.conversation_id || "";
    const projectId = fileInfo.project_id || "";
    const messageId = fileInfo.message_id || "";

    // inline CDN
    if (U.isInlinePointer(fileId) || U.isInlinePointer(pointer)) {
      const url = U.isInlinePointer(pointer) ? pointer : fileId;
      const ext = U.fileExtFromMime(fileInfo.meta?.mime_type || "") || ".bin";
      const name =
        (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
        `${U.sanitize(fileId || pointer)}${ext}`;
      const res = await gmFetchBlob(url);
      return { blob: res.blob, mime: res.mime || fileInfo.meta?.mime_type || "", filename: U.sanitize(name) };
    }

    // sandbox pointer -> interpreter download
    if (pointer && pointer.startsWith("sandbox:")) {
      if (!convId || !messageId) throw new Error("sandbox pointer 缺少 conversation/message id");
      return downloadSandboxFileBlob({ conversationId: convId, messageId, sandboxPath: pointer });
    }

    if (!Cred.token) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("没有 accessToken，无法下载文件");
    }
    const headers = Cred.getAuthHeaders();
    if (projectId) headers.set("chatgpt-project-id", projectId);

    const downloadResult = await fetchDownloadUrlOrResponse(fileId, headers);
    let resp;
    if (downloadResult instanceof Response) {
      resp = downloadResult;
    } else if (typeof downloadResult === "string") {
      const res = await gmFetchBlob(downloadResult);
      const fname =
        (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
        `${fileId}${U.fileExtFromMime(fileInfo.meta?.mime_type || "") || ""}`;
      return {
        blob: res.blob,
        mime: res.mime || fileInfo.meta?.mime_type || "",
        filename: U.sanitize(fname),
      };
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
      (fileInfo.meta && (fileInfo.meta.mime_type || fileInfo.meta.file_type)) ||
      resp.headers.get("Content-Type") ||
      "";
    const ext = U.fileExtFromMime(mime) || ".bin";
    let name =
      (fileInfo.meta && (fileInfo.meta.name || fileInfo.meta.file_name)) ||
      (m && decodeURIComponent(m[1])) ||
      `${fileId}${ext}`;
    name = U.sanitize(name);
    return { blob, mime, filename: name };
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

  // --- 会话列表 / 批量导出工具 -----------------------------------
  async function listConversationsPage({ offset = 0, limit = 100, is_archived, is_starred, order }) {
    if (!Cred.token) await Cred.ensureViaSession();
    const headers = Cred.getAuthHeaders();
    const qs = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });
    if (typeof is_archived === "boolean") qs.set("is_archived", String(is_archived));
    if (typeof is_starred === "boolean") qs.set("is_starred", String(is_starred));
    if (order) qs.set("order", order);
    const url = `${location.origin}/backend-api/conversations?${qs.toString()}`;
    const resp = await fetch(url, { headers, credentials: "include" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`list convs ${resp.status}: ${txt.slice(0, 120)}`);
    }
    return resp.json();
  }

  async function listProjectConversations({ projectId, cursor = 0, limit = 50 }) {
    if (!Cred.token) await Cred.ensureViaSession();
    const headers = Cred.getAuthHeaders();
    const url = `${location.origin}/backend-api/gizmos/${projectId}/conversations?cursor=${cursor}&limit=${limit}`;
    const resp = await fetch(url, { headers, credentials: "include" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`project convs ${resp.status}: ${txt.slice(0, 120)}`);
    }
    return resp.json();
  }

  async function listGizmosSidebar(cursor) {
    if (!Cred.token) await Cred.ensureViaSession();
    const headers = Cred.getAuthHeaders();
    const url = new URL(`${location.origin}/backend-api/gizmos/snorlax/sidebar`);
    url.searchParams.set("conversations_per_gizmo", "0");
    if (cursor) url.searchParams.set("cursor", cursor);
    const resp = await fetch(url.toString(), { headers, credentials: "include" });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`gizmos sidebar ${resp.status}: ${txt.slice(0, 120)}`);
    }
    return resp.json();
  }

  // 参考 chatgpt-exporter：分两阶段拉取 root 和 project 会话，避免遗漏
  async function collectAllConversationTasks(progressCb) {
    const rootSet = new Set();
    const rootInfo = new Map();
    const projectMap = new Map();

    const addRoot = (id, title) => {
      if (!id) return;
      rootSet.add(id);
      if (!rootInfo.has(id)) rootInfo.set(id, { id, title: title || "" });
    };

    const addProjectConv = (projectId, id, title) => {
      if (!projectId || !id) return;
      let rec = projectMap.get(projectId);
      if (!rec) {
        rec = { projectId, projectName: "", createdAt: "", convs: [] };
        projectMap.set(projectId, rec);
      }
      if (!rec.convs.some((x) => x.id === id)) {
        rec.convs.push({ id, title: title || "" });
      }
      if (rootSet.has(id)) {
        rootSet.delete(id);
        rootInfo.delete(id);
      }
    };

    // 1) root conversations (个人空间) — 先拉基础列表，再尝试档/星组合补全
    const fetchRootBasic = async () => {
      const limit = 100;
      let offset = 0;
      while (true) {
        const page = await listConversationsPage({ offset, limit }).catch((e) => {
          console.warn("[ChatGPT-Multimodal-Exporter] list conversations failed", e);
          return null;
        });
        const arr = Array.isArray(page?.items) ? page.items : [];
        arr.forEach((it) => {
          if (!it || !it.id) return;
          const id = it.id;
          const projId = it.conversation_template_id || it.gizmo_id || null;
          if (projId) addProjectConv(projId, id, it.title || "");
          else addRoot(id, it.title || "");
        });
        if (progressCb) progressCb(3, `个人会话：${offset + arr.length}${page?.total ? `/${page.total}` : ""}`);
        if (!arr.length || arr.length < limit || (page && page.total !== null && offset + limit >= page.total)) break;
        offset += limit;
        await U.sleep(120);
      }
    };

    const fetchRootCombos = async () => {
      const combos = [
        { is_archived: false, is_starred: false },
        { is_archived: true, is_starred: false },
        { is_archived: false, is_starred: true },
        { is_archived: true, is_starred: true },
      ];
      const limit = 100;
      for (const c of combos) {
        let offset = 0;
        while (true) {
          const page = await listConversationsPage({
            offset,
            limit,
            is_archived: c.is_archived,
            is_starred: c.is_starred,
            order: "updated",
          }).catch((e) => {
            console.warn("[ChatGPT-Multimodal-Exporter] list conversations failed", e);
            return null;
          });
          const arr = Array.isArray(page?.items) ? page.items : [];
          arr.forEach((it) => {
            if (!it || !it.id) return;
            const id = it.id;
            const projId = it.conversation_template_id || it.gizmo_id || null;
            if (projId) addProjectConv(projId, id, it.title || "");
            else addRoot(id, it.title || "");
          });
          if (progressCb)
            progressCb(
              3,
              `补充扫描：${offset + arr.length}${page?.total ? `/${page.total}` : ""}（归档:${c.is_archived ? "是" : "否"}/星:${c.is_starred ? "是" : "否"}）`
            );
          if (!arr.length || arr.length < limit || (page && page.total !== null && offset + limit >= page.total)) break;
          offset += limit;
          await U.sleep(120);
        }
      }
    };

    try {
      await fetchRootBasic();
      // 如果根会话数量为 0，再尝试档/星组合补全
      if (!rootSet.size) await fetchRootCombos();
    } catch (e) {
      console.warn("[ChatGPT-Multimodal-Exporter] root list error", e);
    }

    // 2) 项目列表 + 项目会话
    try {
      let cursor = null;
      let pageIndex = 0;
      const projectIds = [];
      do {
        const sidebar = await listGizmosSidebar(cursor);
        const items = Array.isArray(sidebar?.items) ? sidebar.items : [];
        pageIndex++;
        items.forEach((it, idx) => {
          const g = it && it.gizmo && it.gizmo.gizmo;
          if (!g || !g.id) {
            if (progressCb) progressCb(4, `扫描项目第${pageIndex}页：${idx + 1}/${items.length}`);
            return;
          }
          const pid = g.id;
          const pname = (g.display && g.display.name) || "";
          const createdAt = g.created_at || "";
          let rec = projectMap.get(pid);
          if (!rec) {
            rec = { projectId: pid, projectName: pname || pid, createdAt, convs: [] };
            projectMap.set(pid, rec);
          } else {
            if (!rec.projectName && pname) rec.projectName = pname;
            if (!rec.createdAt && createdAt) rec.createdAt = createdAt;
          }
          projectIds.push(pid);
          if (progressCb) progressCb(4, `扫描项目第${pageIndex}页：${idx + 1}/${items.length}`);
        });
        cursor = sidebar && sidebar.cursor ? sidebar.cursor : null;
      } while (cursor);

      // 拉取各项目会话
      for (const pid of projectIds) {
        let cursor = 0;
        const limit = 50;
        while (true) {
          const page = await listProjectConversations({ projectId: pid, cursor, limit }).catch((e) => {
            console.warn("[ChatGPT-Multimodal-Exporter] project conversations failed", e);
            return null;
          });
          const arr = Array.isArray(page?.items) ? page.items : [];
          arr.forEach((it) => {
            if (!it || !it.id) return;
            addProjectConv(pid, it.id, it.title || "");
          });
          if (progressCb) progressCb(5, `项目 ${pid}：${cursor + arr.length}${page?.total ? `/${page.total}` : ""}`);
          if (!arr.length || arr.length < limit || (page && page.total !== null && cursor + limit >= page.total)) break;
          cursor += limit;
          await U.sleep(120);
        }
      }
    } catch (e) {
      console.warn("[ChatGPT-Multimodal-Exporter] project list error", e);
    }

    const rootIds = Array.from(rootSet);
    const roots = Array.from(rootInfo.values());
    const projects = Array.from(projectMap.values());
    return { rootIds, roots, projects };
  }

  async function fetchConvWithRetry(id, projectId, retries = 2) {
    let attempt = 0;
    let lastErr = null;
    while (attempt <= retries) {
      try {
        return await fetchConversation(id, projectId);
      } catch (e) {
        lastErr = e;
        attempt++;
        const delay = 400 * Math.pow(2, attempt - 1);
        await U.sleep(delay);
      }
    }
    throw lastErr || new Error("fetch_failed");
  }

  async function fetchConversationsBatch(tasks, concurrency, progressCb, cancelRef) {
    const total = tasks.length;
    if (!total) return [];
    const results = new Array(total);
    let done = 0;
    let index = 0;
    let fatalErr = null;

    const worker = async () => {
      while (true) {
        if (cancelRef && cancelRef.cancel) return;
        if (fatalErr) return;
        const i = index++;
        if (i >= total) return;
        const t = tasks[i];
        try {
          const data = await fetchConvWithRetry(t.id, t.projectId, 2);
          results[i] = data;
          done++;
          const pct = total ? Math.round((done / total) * 60) + 10 : 10;
          if (progressCb) progressCb(pct, `导出 JSON：${done}/${total}`);
        } catch (e) {
          fatalErr = e;
          return;
        }
      }
    };

    const n = Math.max(1, Math.min(concurrency || 1, total));
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
    if (fatalErr) throw fatalErr;
    return results;
  }

  function buildProjectFolderNames(projects) {
    const map = new Map();
    const counts = {};
    projects.forEach((p) => {
      const base = U.sanitize(p.projectName || p.projectId || "project");
      counts[base] = (counts[base] || 0) + 1;
    });
    projects.forEach((p) => {
      let baseName = U.sanitize(p.projectName || p.projectId || "project");
      if (counts[baseName] > 1) {
        const stamp = p.createdAt ? p.createdAt.replace(/[^\d]/g, "").slice(0, 14) : "";
        if (stamp) {
          const raw = p.projectName || baseName;
          baseName = U.sanitize(`${raw}_${stamp}`);
        }
      }
      map.set(p.projectId, baseName || "project");
    });
    return map;
  }

  async function runBatchExport({
    tasks,
    projects,
    rootIds,
    includeAttachments = true,
    concurrency = BATCH_CONCURRENCY,
    progressCb,
    cancelRef,
  }) {
    if (!tasks || !tasks.length) throw new Error("任务列表为空");
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    const zip = new JSZip();
    const summary = {
      exported_at: new Date().toISOString(),
      total_conversations: tasks.length,
      root: { count: rootIds.length, ids: rootIds },
      projects: (projects || []).map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName || "",
        createdAt: p.createdAt || "",
        count: Array.isArray(p.convs) ? p.convs.length : 0,
      })),
      attachments_map: [],
      failed: { conversations: [], attachments: [] },
    };

    const folderNameByProjectId = buildProjectFolderNames(projects || []);
    const rootJsonFolder = zip.folder("json");
    const rootAttFolder = zip.folder("attachments");
    const projCache = new Map(); // pid -> {json, att}

    const results = await fetchConversationsBatch(tasks, concurrency, progressCb, cancelRef);
    if (cancelRef && cancelRef.cancel) throw new Error("用户已取消");

    let idxRoot = 0;
    const projSeq = {};

    for (let i = 0; i < tasks.length; i++) {
      if (cancelRef && cancelRef.cancel) throw new Error("用户已取消");
      const t = tasks[i];
      const data = results[i];
      if (!data) {
        summary.failed.conversations.push({
          id: t.id,
          projectId: t.projectId || "",
          reason: "为空",
        });
        continue;
      }
      const isProject = !!t.projectId;
      let baseFolderJson = rootJsonFolder;
      let baseFolderAtt = rootAttFolder;
      let seq = "";
      if (isProject) {
        const fname = folderNameByProjectId.get(t.projectId) || U.sanitize(t.projectId || "project");
        let cache = projCache.get(t.projectId);
        if (!cache) {
          const rootFolder = zip.folder(`projects/${fname}`);
          cache = {
            json: rootFolder ? rootFolder.folder("json") : null,
            att: rootFolder ? rootFolder.folder("attachments") : null,
          };
          projCache.set(t.projectId, cache);
        }
        baseFolderJson = cache.json || rootJsonFolder;
        baseFolderAtt = cache.att || rootAttFolder;
        projSeq[t.projectId] = (projSeq[t.projectId] || 0) + 1;
        seq = String(projSeq[t.projectId]).padStart(3, "0");
      } else {
        idxRoot++;
        seq = String(idxRoot).padStart(3, "0");
      }

      const title = U.sanitize(data?.title || "");
      const baseName = `${seq}_${title || "chat"}_${t.id}`;
      const jsonName = `${baseName}.json`;
      if (baseFolderJson) {
        baseFolderJson.file(jsonName, JSON.stringify(data, null, 2));
      } else {
        zip.file(jsonName, JSON.stringify(data, null, 2));
      }

      if (!includeAttachments) {
        if (progressCb) progressCb(80, `写入 JSON：${i + 1}/${tasks.length}`);
        continue;
      }

      const candidates = collectFileCandidates(data).map((x) => ({
        ...x,
        project_id: t.projectId || "",
      }));
      if (!candidates.length) {
        if (progressCb) progressCb(80, `附件：${i + 1}/${tasks.length}（无）`);
        continue;
      }
      const convAttFolder = baseFolderAtt ? baseFolderAtt.folder(baseName) : null;
      const usedNames = new Set();
      for (const c of candidates) {
        if (cancelRef && cancelRef.cancel) throw new Error("用户已取消");
        const pointerKey = c.pointer || c.file_id || "";
        const originalName =
          (c.meta && (c.meta.name || c.meta.file_name)) ||
          "";
        let finalName = "";
        try {
          const res = await downloadPointerOrFileAsBlob(c);
          finalName = res.filename || `${U.sanitize(pointerKey) || "file"}.bin`;
          if (usedNames.has(finalName)) {
            let cnt = 2;
            while (usedNames.has(`${cnt}_${finalName}`)) cnt++;
            finalName = `${cnt}_${finalName}`;
          }
          usedNames.add(finalName);
          if (convAttFolder) convAttFolder.file(finalName, res.blob);
          summary.attachments_map.push({
            conversation_id: data.conversation_id || t.id,
            project_id: t.projectId || "",
            pointer: c.pointer || "",
            file_id: c.file_id || "",
            saved_as: finalName,
            source: c.source || "",
            mime: res.mime || c.meta?.mime_type || "",
            original_name: originalName,
            size_bytes:
              c.meta?.size_bytes ||
              c.meta?.size ||
              c.meta?.file_size ||
              c.meta?.file_size_bytes ||
              null,
          });
        } catch (e) {
          summary.failed.attachments.push({
            conversation_id: data.conversation_id || t.id,
            project_id: t.projectId || "",
            pointer: c.pointer || c.file_id || "",
            error: e && e.message ? e.message : String(e),
          });
        }
      }
      if (progressCb) progressCb(80 + Math.round(((i + 1) / tasks.length) * 15), `附件：${i + 1}/${tasks.length}`);
    }

    zip.file("summary.json", JSON.stringify(summary, null, 2));
    if (progressCb) progressCb(98, "压缩中…");
    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 7 },
    });
    return blob;
  }

  // --- 批量导出对话 + 附件 UI -----------------------------------
  function showBatchExportDialog() {
    const overlay = U.ce("div", { className: "cgptx-modal" });
    const box = U.ce("div", { className: "cgptx-modal-box" });

    const header = U.ce("div", { className: "cgptx-modal-header" });
    const title = U.ce("div", {
      className: "cgptx-modal-title",
      textContent: "批量导出对话（JSON + 附件）",
    });

    const actions = U.ce("div", { className: "cgptx-modal-actions" });
    const btnClose = U.ce("button", { className: "cgptx-btn", textContent: "关闭" });
    const btnToggle = U.ce("button", { className: "cgptx-btn", textContent: "全选/反选" });
    const btnStart = U.ce("button", { className: "cgptx-btn primary", textContent: "开始导出" });
    const btnStop = U.ce("button", { className: "cgptx-btn", textContent: "停止", disabled: true });
    actions.append(btnToggle, btnStart, btnStop, btnClose);
    header.append(title, actions);

    const status = U.ce("div", { className: "cgptx-chip", textContent: "加载会话列表…" });
    const opts = U.ce("div", { className: "cgptx-modal-actions", style: "justify-content:flex-start;" });
    const optAttachLabel = U.ce("label", { style: "display:flex;align-items:center;gap:6px;" });
    const optAttachments = U.ce("input", { type: "checkbox", checked: true });
    const optTxt = U.ce("span", { textContent: "包含附件（ZIP）" });
    optAttachLabel.append(optAttachments, optTxt);
    opts.append(optAttachLabel);

    const listWrap = U.ce("div", {
      className: "cgptx-list",
      style: "max-height:46vh;overflow:auto;border:1px solid #1f2937;border-radius:10px;",
    });

    const progText = U.ce("div", { className: "cgptx-chip", textContent: "" });

    box.append(header, status, opts, listWrap, progText);
    overlay.append(box);
    document.body.append(overlay);

    const close = () => overlay.remove();
    btnClose.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    let listData = null;
    let checkboxes = [];
    const cancelRef = { cancel: false };

    const setStatus = (txt) => {
      status.textContent = txt;
    };
    const setProgress = (pct, txt) => {
      progText.textContent = `${txt || ""} ${pct ? `(${pct}%)` : ""}`;
    };

    const getRootsList = (data) => {
      if (data && Array.isArray(data.roots) && data.roots.length) return data.roots;
      if (data && Array.isArray(data.rootIds) && data.rootIds.length)
        return data.rootIds.map((id) => ({ id, title: id }));
      return [];
    };

    const renderList = (data) => {
      listWrap.innerHTML = "";
      checkboxes = [];
      const addGroup = (titleText, items, projectId) => {
        const group = U.ce("div", {
          style:
            "border-bottom:1px solid #1f2937;padding:10px 8px;display:flex;flex-direction:column;gap:8px;",
        });
        const h = U.ce("div", { className: "title", textContent: titleText });
        group.append(h);
        items.forEach((it) => {
          const row = U.ce("div", { className: "cgptx-item" });
          const cb = U.ce("input", {
            type: "checkbox",
            checked: true,
            defaultChecked: true,
            "data-id": it.id,
            "data-project": projectId || "",
          });
          const body = U.ce("div");
          const titleEl = U.ce("div", { className: "title", textContent: it.title || it.id });
          const metaEl = U.ce("div", {
            className: "meta",
            textContent: projectId ? `项目: ${projectId}` : "个人会话",
          });
          body.append(titleEl, metaEl);
          row.append(cb, body);
          group.append(row);
          checkboxes.push(cb);
        });
        listWrap.append(group);
      };

      const rootsList = getRootsList(data);
      if (rootsList.length) addGroup("根目录会话", rootsList, "");
      (data.projects || []).forEach((p) => {
        const convs = Array.isArray(p.convs) ? p.convs : [];
        if (!convs.length) return;
        addGroup(`项目：${p.projectName || p.projectId}`, convs, p.projectId);
      });
      setStatus(`已加载：根会话 ${rootsList.length}，项目 ${data.projects.length}`);
    };

    const toggleAll = () => {
      if (!checkboxes.length) return;
      const allChecked = checkboxes.every((c) => c.checked);
      checkboxes.forEach((c) => (c.checked = !allChecked));
    };
    btnToggle.addEventListener("click", toggleAll);

    const startExport = async () => {
      if (!listData) return;
      // 直接从 DOM 取最新的勾选状态，防止引用过期
      const liveBoxes = Array.from(listWrap.querySelectorAll('input[type="checkbox"]'));
      const selectedIds = new Set(liveBoxes.filter((c) => c.checked).map((c) => c.getAttribute("data-id")));
      if (!selectedIds.size) {
        alert("请至少选择一条会话");
        return;
      }
      cancelRef.cancel = false;
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnToggle.disabled = true;
      setStatus("准备导出…");

      // 直接用勾选框构建任务，避免数据结构不一致导致遗漏
      const tasks = [];
      const seen = new Set();
      let anyChecked = false;
      liveBoxes
        .filter((c) => c.checked)
        .forEach((c) => {
          const id = c.getAttribute("data-id") || "";
          const projectId = c.getAttribute("data-project") || null;
          if (!id) return;
          const key = `${projectId || "root"}::${id}`;
          if (seen.has(key)) return;
          seen.add(key);
          tasks.push({ id, projectId });
          anyChecked = true;
        });
      // 兜底：如果没有检测到选中但存在列表，则默认全选一次
      if (!tasks.length && liveBoxes.length) {
        console.warn("[ChatGPT-Multimodal-Exporter] 未检测到选中项，兜底使用全选");
        liveBoxes.forEach((c) => {
          const id = c.getAttribute("data-id") || "";
          const projectId = c.getAttribute("data-project") || null;
          if (!id) return;
          const key = `${projectId || "root"}::${id}`;
          if (seen.has(key)) return;
          seen.add(key);
          tasks.push({ id, projectId });
        });
        anyChecked = true;
      }
      if (!tasks.length) {
        console.warn("[ChatGPT-Multimodal-Exporter] 无任务：listData=", listData, "checkboxes=", checkboxes);
        alert("未能解析勾选的会话，请重试或刷新页面");
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnToggle.disabled = false;
        return;
      }

      const progressCb = (pct, txt) => setProgress(pct, txt || "");

      // 只在项目列表中存在的项传递项目元数据（用于命名）
      const projectMapForTasks = new Map();
      (listData.projects || []).forEach((p) => projectMapForTasks.set(p.projectId, p));
      const selectedProjects = tasks
        .map((t) => t.projectId)
        .filter((pid) => !!pid)
        .map((pid) => projectMapForTasks.get(pid))
        .filter(Boolean);
      const selectedRootIds = tasks.filter((t) => !t.projectId).map((t) => t.id);

      try {
        const blob = await runBatchExport({
          tasks,
          projects: selectedProjects,
          rootIds: selectedRootIds,
          includeAttachments: !!optAttachments.checked,
          concurrency: BATCH_CONCURRENCY,
          progressCb,
          cancelRef,
        });
        if (cancelRef.cancel) {
          setStatus("已取消");
          return;
        }
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        saveBlob(blob, `chatgpt-batch-${ts}.zip`);
        setStatus("完成 ✅（已下载 ZIP）");
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 批量导出失败", e);
        alert("批量导出失败：" + (e && e.message ? e.message : e));
        setStatus("失败");
      } finally {
        btnStart.disabled = false;
        btnStop.disabled = true;
        btnToggle.disabled = false;
        cancelRef.cancel = false;
      }
    };

    btnStart.addEventListener("click", startExport);
    btnStop.addEventListener("click", () => {
      cancelRef.cancel = true;
      btnStop.disabled = true;
      setStatus("请求取消中…");
    });

    // 拉列表
    (async () => {
      try {
        // 参考 chatgpt-exporter 的多组合扫描逻辑
        const res = await collectAllConversationTasks((pct, text) => setProgress(pct, text));
        listData = res;
        renderList(res);
        setStatus("请选择要导出的会话");
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 拉取列表失败", e);
        setStatus("拉取列表失败");
        alert("拉取列表失败：" + (e && e.message ? e.message : e));
      }
    })();
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

    const btnBatch = U.ce("button", {
      id: "cgptx-mini-btn-batch",
      className: "cgptx-mini-btn",
      title: "批量导出 JSON + 附件（可勾选）",
      textContent: "🗂",
    });

    row.append(btnJson, btnFiles, btnBatch);
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

    // 批量导出入口
    btnBatch.addEventListener("click", async () => {
      btnBatch.disabled = true;
      btnBatch.title = "加载中…";
      try {
        await refreshCredStatus();
        showBatchExportDialog();
      } catch (e) {
        console.error("[ChatGPT-Multimodal-Exporter] 打开批量导出失败", e);
        alert("打开批量导出失败: " + (e && e.message ? e.message : e));
      } finally {
        btnBatch.disabled = false;
        btnBatch.title = "批量导出 JSON + 附件（可勾选）";
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
