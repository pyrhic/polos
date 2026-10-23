// 유튜브 업로드 값(제목·설명·태그·채널) 검사 — Studio 업로드(/api/trigger-upload)와 생성 후 자동 업로드(/api/trigger-generation)가 같이 쓴다.
import { loadChannels, isValidSlot } from "./channels.js";

// 유튜브 API는 제목/설명의 < > 를 허용하지 않는다.
export const clean = (s) => String(s || "").replace(/[<>]/g, "").trim();

// { title, description, tags, channelSlot } → { meta: { title, description, tags, channel_slot, channel_label } } 또는 { error }
// 항상 비공개로만 올리므로 공개 범위는 받지 않는다.
export async function checkUploadMeta({ title, description, tags, channelSlot }) {
  const slot = String(channelSlot || "1");
  const channel = isValidSlot(slot) && (await loadChannels()).find((c) => c.slot === slot);
  if (!channel) return { error: "올릴 채널 번호가 올바르지 않습니다" };
  if (!channel.ready) return { error: "이 채널은 아직 로그인 연결이 끝나지 않았습니다" };
  const cleanTitle = clean(title);
  if (!cleanTitle) return { error: "title이 필요합니다" };
  if (cleanTitle.length > 100) return { error: "제목은 100자 이내여야 합니다" };
  const cleanDesc = clean(description);
  if (cleanDesc.length > 5000) return { error: "설명은 5000자 이내여야 합니다" };
  return { meta: { title: cleanTitle, description: cleanDesc, tags: clean(tags), channel_slot: slot, channel_label: channel.label } };
}
