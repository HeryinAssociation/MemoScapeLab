"use client";

import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/src/auth/client";
import type { ImageGenProviderName } from "@/worker/image-gen/types";
import type { ImageGenSettingsView } from "@/worker/image-gen/settings";

const PROVIDER_LABELS: Record<ImageGenProviderName, { name: string; desc: string }> = {
  seedream: { name: "Seedream（火山方舟）", desc: "Doubao Seedream 图片生成，API Key 在火山方舟控制台获取" },
  openai: { name: "OpenAI", desc: "/v1/images/edits，GPT Image 系列模型" },
  qwen: { name: "Qwen（阿里云百炼）", desc: "qwen-image-3.0-pro，需先申请邀测；北京/新加坡地域 key 独立" },
};

const PROVIDER_ORDER: ImageGenProviderName[] = ["seedream", "openai", "qwen"];

const PROVIDER_FIELDS: Record<ImageGenProviderName, { model: string; baseUrl: string; key: string }> = {
  seedream: { model: "SEEDREAM_MODEL", baseUrl: "SEEDREAM_BASE_URL", key: "ARK_API_KEY" },
  openai: { model: "OPENAI_IMAGE_MODEL", baseUrl: "OPENAI_BASE_URL", key: "OPENAI_API_KEY" },
  qwen: { model: "QWEN_IMAGE_MODEL", baseUrl: "QWEN_IMAGE_BASE_URL", key: "DASHSCOPE_API_KEY" },
};

type LoadState = "loading" | "ready" | "error";

interface Draft {
  model: string;
  baseUrl: string;
  apiKey: string;
  clearKey: boolean;
}

export function ImageGenSettingsApp() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [message, setMessage] = useState("正在读取生成设置");
  const [view, setView] = useState<ImageGenSettingsView | null>(null);
  const [provider, setProvider] = useState<ImageGenProviderName | "">("");
  const [drafts, setDrafts] = useState<Record<ImageGenProviderName, Draft>>({
    seedream: { model: "", baseUrl: "", apiKey: "", clearKey: false },
    openai: { model: "", baseUrl: "", apiKey: "", clearKey: false },
    qwen: { model: "", baseUrl: "", apiKey: "", clearKey: false },
  });
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoadState("loading");
    setMessage("正在读取生成设置");
    try {
      const response = await authenticatedFetch("/api/settings/imagegen");
      const payload = (await response.json()) as ImageGenSettingsView & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "设置读取失败");
      setView(payload);
      setProvider(payload.provider);
      setDrafts({
        seedream: draftFrom(payload.providers.seedream),
        openai: draftFrom(payload.providers.openai),
        qwen: draftFrom(payload.providers.qwen),
      });
      setLoadState("ready");
      setMessage("已加载当前生成配置");
    } catch (error) {
      setLoadState("error");
      setMessage(error instanceof Error ? error.message : "设置读取失败");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const updateDraft = (name: ImageGenProviderName, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [name]: { ...current[name], ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    setMessage("正在保存生成设置");
    try {
      const providers = {} as Record<ImageGenProviderName, { model?: string; baseUrl?: string; apiKey?: string }>;
      for (const name of PROVIDER_ORDER) {
        const draft = drafts[name];
        providers[name] = {
          model: draft.model,
          baseUrl: draft.baseUrl,
          // 未输入且未勾选清除 → 保持不变；勾选清除 → 清空；输入了新值 → 设置
          ...(draft.clearKey ? { apiKey: "" } : draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        };
      }
      const response = await authenticatedFetch("/api/settings/imagegen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, providers }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "保存失败");
      await refresh();
      setMessage("生成设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="source-step">
      <div className="step-intro">
        <span>IMAGE GENERATION SETTINGS</span>
        <h1>生成设置</h1>
        <p>
          配置图片生成厂商与密钥。非密钥配置与模型信息明文保存，密钥经 AES-GCM 加密后入库（主密钥
          <code>SETTINGS_ENCRYPTION_KEY</code> 来自环境变量）；未配置主密钥时密钥只能走环境变量，不能在此保存。
        </p>
      </div>

      <div className="source-layout">
        <div style={{ display: "grid", gap: 18 }}>
          {PROVIDER_ORDER.map((name) => {
            const info = view?.providers[name];
            const draft = drafts[name];
            const fields = PROVIDER_FIELDS[name];
            return (
              <div className="metadata-card" key={name}>
                <div className="metadata-heading">
                  <span>
                    <small>{fields.key} / {fields.model}</small>
                    <h2>{PROVIDER_LABELS[name].name}</h2>
                  </span>
                  <span>{info?.keySource === "db" ? "密钥已入库" : info?.keySource === "env" ? "环境变量" : "未配置"}</span>
                </div>
                {info?.keyLocked && (
                  <p style={{ margin: "0 0 14px", color: "#b34c3c", fontSize: 10 }}>
                    密钥已加密入库但主密钥缺失或不匹配，无法读取，请检查 SETTINGS_ENCRYPTION_KEY。
                  </p>
                )}
                <label>
                  <span>模型（{fields.model}）</span>
                  <input
                    value={draft.model}
                    onChange={(event) => updateDraft(name, { model: event.target.value })}
                    placeholder={info?.model || "模型 ID，如 doubao-seedream-4-0-250828"}
                  />
                </label>
                <label>
                  <span>Base URL（{fields.baseUrl}）</span>
                  <input
                    value={draft.baseUrl}
                    onChange={(event) => updateDraft(name, { baseUrl: event.target.value })}
                    placeholder="只填域名前缀，不含接口路径（如 https://ark.cn-beijing.volces.com/api/v3），留空用默认值"
                  />
                  <small style={{ color: "rgba(7,16,12,0.4)", fontSize: 8, lineHeight: 1.6 }}>
                    误填完整接口地址也没关系，保存后会自动归一化。
                  </small>
                </label>
                <label>
                  <span>API Key（{fields.key}）</span>
                  <input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => updateDraft(name, { apiKey: event.target.value, clearKey: false })}
                    placeholder={info?.apiKeyMasked || (info?.apiKeyConfigured ? "已配置，输入新值可替换" : "输入 API Key")}
                    autoComplete="off"
                  />
                </label>
                {info?.apiKeyConfigured && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={draft.clearKey}
                      onChange={(event) => updateDraft(name, { clearKey: event.target.checked })}
                      style={{ width: "auto", padding: 0, border: 0, margin: 0 }}
                    />
                    <span style={{ margin: 0, color: "rgba(7,16,12,0.55)", fontSize: 8 }}>清除该厂商已保存的密钥</span>
                  </label>
                )}
                <p style={{ margin: "10px 0 0", color: "rgba(7,16,12,0.4)", fontSize: 8, lineHeight: 1.7 }}>
                  {PROVIDER_LABELS[name].desc}
                </p>
              </div>
            );
          })}
        </div>

        <div className="metadata-card" style={{ alignSelf: "start" }}>
          <div className="metadata-heading">
            <span>
              <small>SAVE</small>
              <h2>保存配置</h2>
            </span>
            <span>#{view?.encryptionConfigured ? "加密可用" : "只读密钥"}</span>
          </div>
          <p style={{ margin: "0 0 16px", color: "rgba(7,16,12,0.55)", fontSize: 10, lineHeight: 1.8 }}>
            {view?.encryptionConfigured
              ? "主密钥已配置，页面可加密保存 API Key。"
              : "未配置 SETTINGS_ENCRYPTION_KEY：模型与地址可保存，API Key 只能通过 .dev.vars / Cloudflare Secret 提供。"}
          </p>
          <div className="metadata-action-row">
            <small>{message}</small>
            <button type="button" disabled={saving || loadState !== "ready"} onClick={save}>
              保存设置{saving ? "…" : ""}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function draftFrom(info: ImageGenSettingsView["providers"][ImageGenProviderName]): Draft {
  return { model: info.model, baseUrl: info.baseUrl, apiKey: "", clearKey: false };
}
