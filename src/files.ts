// @ts-nocheck

import { U } from './utils';

export function collectFileCandidates(conv) {
  const mapping = (conv && conv.mapping) || {};
  const out = new Map();
  const convId = conv?.conversation_id || '';

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

    (meta.attachments || []).forEach((att) => {
      if (!att || !att.id) return;
      add(att.id, { source: 'attachment', meta: att });
    });

    const crefByFile = meta.content_references_by_file || {};
    Object.values(crefByFile)
      .flat()
      .forEach((ref) => {
        if (ref?.file_id) add(ref.file_id, { source: 'cref', meta: ref, message_id: msg.id });
        if (ref?.asset_pointer) {
          const fid = U.pointerToFileId(ref.asset_pointer);
          add(fid, { source: 'cref-pointer', pointer: ref.asset_pointer, meta: ref, message_id: msg.id });
        }
      });

    const n7 = meta.n7jupd_crefs_by_file || meta.n7jupd_crefs || {};
    const n7list = Array.isArray(n7) ? n7 : Object.values(n7).flat();
    n7list.forEach((ref) => {
      if (ref?.file_id) add(ref.file_id, { source: 'n7jupd-cref', meta: ref, message_id: msg.id });
    });

    if (Array.isArray(c.parts)) {
      c.parts.forEach((part) => {
        if (part && typeof part === 'object' && part.content_type && part.asset_pointer) {
          const fid = U.pointerToFileId(part.asset_pointer);
          add(fid, { source: part.content_type, pointer: part.asset_pointer, meta: part, message_id: msg.id });
        }
        if (
          part &&
          typeof part === 'object' &&
          part.content_type === 'real_time_user_audio_video_asset_pointer' &&
          part.audio_asset_pointer &&
          part.audio_asset_pointer.asset_pointer
        ) {
          const ap = part.audio_asset_pointer;
          const fid = U.pointerToFileId(ap.asset_pointer);
          add(fid, { source: 'voice-audio', pointer: ap.asset_pointer, meta: ap, message_id: msg.id });
        }
        if (part && typeof part === 'object' && part.audio_asset_pointer && part.audio_asset_pointer.asset_pointer) {
          const ap = part.audio_asset_pointer;
          const fid = U.pointerToFileId(ap.asset_pointer);
          add(fid, { source: 'voice-audio', pointer: ap.asset_pointer, meta: ap, message_id: msg.id });
        }
      });
    }

    if (c.content_type === 'text' && Array.isArray(c.parts)) {
      c.parts.forEach((txt) => {
        if (typeof txt !== 'string') return;
        const matches = txt.match(/\{\{file:([^}]+)\}\}/g) || [];
        matches.forEach((tok) => {
          const fid = tok.slice(7, -2);
          add(fid, { source: 'inline-placeholder', message_id: msg.id });
        });
        const sandboxLinks = txt.match(/sandbox:[^\s\)\]]+/g) || [];
        sandboxLinks.forEach((s) => {
          add(s, { source: 'sandbox-link', pointer: s, message_id: msg.id });
        });
      });
    }
  }
  return [...out.values()];
}

export function extractImages(conv) {
  const mapping = conv && conv.mapping ? conv.mapping : {};
  const images = [];
  const seen = new Set();

  for (const key in mapping) {
    const node = mapping[key];
    if (!node || !node.message) continue;
    const msg = node.message;
    const role = msg.author && msg.author.role;
    const msgId = msg.id;

    const meta = msg.metadata || {};
    if (Array.isArray(meta.attachments)) {
      for (const att of meta.attachments) {
        if (!att || !att.id) continue;
        const fileId = att.id;
        if (seen.has(fileId)) continue;
        seen.add(fileId);
        images.push({
          kind: 'attachment',
          file_id: fileId,
          name: att.name || '',
          mime_type: att.mime_type || '',
          size_bytes: att.size || att.size_bytes || null,
          message_id: msgId,
          role,
          source: 'upload',
        });
      }
    }

    const c = msg.content;
    if (c && c.content_type === 'multimodal_text' && Array.isArray(c.parts)) {
      for (const part of c.parts) {
        if (part && typeof part === 'object' && part.content_type === 'image_asset_pointer') {
          const pointer = part.asset_pointer || '';
          let fileId = '';
          const m = pointer.match(/file_[0-9a-f]+/i);
          if (m) fileId = m[0];
          const keyId = fileId || pointer;
          if (seen.has(keyId)) continue;
          seen.add(keyId);
          images.push({
            kind: 'asset_pointer',
            file_id: fileId,
            pointer,
            width: part.width,
            height: part.height,
            size_bytes: part.size_bytes,
            message_id: msgId,
            role,
            source: 'asset_pointer',
          });
        }
      }
    }
  }

  console.log('[ChatGPT-Multimodal-Exporter] 找到的图片信息：', images);
  return images;
}
