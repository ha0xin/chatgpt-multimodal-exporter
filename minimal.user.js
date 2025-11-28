// ==UserScript==
// @name         ChatGPT-Exporter-Minimal+Images
// @namespace    chatgpt-multimodal-exporter
// @version      0.3.0
// @description  最小版：检测凭证 + 导出当前对话 JSON + 提取并下载图片（处理 download_url）
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-end
// @grant        none
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
      "[ChatGPT-Exporter-Minimal+Images] 找到的图片信息：",
      images
    );
    return images;
  }

  // --- 根据 file_id 下载图片（先拿 JSON，再用 download_url） ------
  async function downloadImageFile(fileId, meta) {
    if (!fileId) {
      console.warn("[ChatGPT-Exporter] 缺少 file_id，跳过该图片", meta);
      return;
    }
    if (!Cred.token) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("无法获取登录凭证（下载图片）");
    }

    const headers = Cred.getAuthHeaders();
    // 第一步：请求 files/download 接口，拿 JSON（包含 download_url）
    const url = `${location.origin}/backend-api/files/download/${fileId}?post_id=&inline=false`;
    const init = {
      method: "GET",
      credentials: "include",
      headers,
    };

    let resp = await fetch(url, init).catch(() => null);
    if (!resp) throw new Error("网络错误（下载图片 metadata）");

    if (resp.status === 401) {
      const ok = await Cred.ensureViaSession();
      if (!ok) throw new Error("401：重新获取凭证失败（下载图片 metadata）");
      init.headers = Cred.getAuthHeaders();
      resp = await fetch(url, init).catch(() => null);
      if (!resp) throw new Error("网络错误（下载图片 metadata 重试）");
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(
        `下载 metadata 失败 file_id=${fileId} HTTP ${resp.status}: ${txt.slice(
          0,
          120
        )}`
      );
    }

    let metaJson;
    try {
      metaJson = await resp.json();
    } catch (e) {
      throw new Error("下载接口返回的不是 JSON（无法解析 download_url）");
    }

    const downloadUrl = metaJson && metaJson.download_url;
    if (!downloadUrl) {
      console.warn("[ChatGPT-Exporter] metadata 中没有 download_url", metaJson);
      throw new Error("metadata 中未找到 download_url");
    }

    // 第二步：真正去下载 download_url 对应的图片内容
    // 这个 URL 通常已经带了签名参数，可以直接 GET
    const resp2 = await fetch(downloadUrl, {
      method: "GET",
      credentials: "include",
    }).catch(() => null);

    if (!resp2) {
      throw new Error("网络错误（下载图片内容）");
    }
    if (!resp2.ok) {
      const txt2 = await resp2.text().catch(() => "");
      throw new Error(
        `下载图片内容失败 file_id=${fileId} HTTP ${resp2.status}: ${txt2.slice(
          0,
          120
        )}`
      );
    }

    const blob = await resp2.blob();

    // 尝试确定文件名
    let filename = (meta && meta.name) || metaJson.file_name || "";
    const mimeFromMeta = meta && meta.mime_type;
    const mimeFromJson = metaJson && metaJson.mime_type;
    const mimeHeader = resp2.headers.get("Content-Type");
    const mime = mimeFromMeta || mimeFromJson || mimeHeader || "";

    if (!filename) {
      // 从 Content-Disposition 中尝试解析
      const cd = resp2.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
      if (m) {
        filename = decodeURIComponent(m[1]);
      }
    }

    if (!filename) {
      let ext = "";
      if (mime === "image/png") ext = ".png";
      else if (mime === "image/jpeg") ext = ".jpg";
      else if (mime === "image/webp") ext = ".webp";
      else if (mime && mime.startsWith("image/"))
        ext = "." + mime.split("/")[1];
      else ext = ".png";
      filename = `${fileId}${ext}`;
    }

    saveBlob(blob, filename);
  }

  async function downloadAllImagesForConversation(conv) {
    const imgs = extractImages(conv);
    if (!imgs.length) {
      alert("当前对话中未找到图片（上传或生成的 image_asset_pointer）。");
      return;
    }

    for (const img of imgs) {
      try {
        await downloadImageFile(img.file_id, img);
      } catch (e) {
        console.error(
          "[ChatGPT-Exporter-Minimal+Images] 下载单个图片失败：",
          img,
          e
        );
      }
    }
    alert(`尝试下载完毕，成功与否请查看浏览器下载列表或控制台。`);
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

    // 图片下载按钮
    const btnImg = U.ce("button", {
      id: "cgptx-mini-btn-img",
      className: "cgptx-mini-btn",
      title: "下载当前对话中的图片（上传 + 生成）",
      textContent: "🖼",
    });

    row.append(btnJson, btnImg);
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
        console.error("[ChatGPT-Exporter-Minimal+Images] 导出失败：", e);
        alert("导出失败: " + (e && e.message ? e.message : e));
        btnJson.title = "导出失败 ❌（点击重试）";
      } finally {
        btnJson.disabled = false;
      }
    });

    // 下载图片按钮
    btnImg.addEventListener("click", async () => {
      const id = U.convId();
      const pid = U.projectId();
      if (!id) {
        alert("未检测到会话 ID，请在具体对话页面使用（URL 中应包含 /c/xxxx）。");
        return;
      }

      btnImg.disabled = true;
      btnImg.title = "下载图片中…";

      try {
        await refreshCredStatus();
        if (!Cred.token) throw new Error("没有有效的 accessToken");

        // 优先使用缓存的 lastConvData，没有就重新拉一次
        let data = lastConvData;
        if (!data || data.conversation_id !== id) {
          data = await fetchConversation(id, pid || undefined);
          lastConvData = data;
        }

        await downloadAllImagesForConversation(data);
        btnImg.title = "图片下载尝试完成 ✅（可再次点击）";
      } catch (e) {
        console.error(
          "[ChatGPT-Exporter-Minimal+Images] 下载图片失败：",
          e
        );
        alert("下载图片失败: " + (e && e.message ? e.message : e));
        btnImg.title = "下载图片失败 ❌（点击重试）";
      } finally {
        btnImg.disabled = false;
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
