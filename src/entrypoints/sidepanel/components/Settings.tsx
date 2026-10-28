import { useEffect, useMemo, useState } from "react";
import { useSettings } from "../store/settings";
import { setSecret } from "@/core/storage";
import { DEFAULT_SETTINGS as DEFAULTS } from "@/core/schema/settings";

interface ChatTestPortEnv {
  type: string;
  event?: { type: string; text?: string };
  message?: string;
}

/** Settings — PRD §7.4: provider config is data, not code. FR8: swap via settings only. */
export function SettingsView() {
  const { settings, save } = useSettings();
  const [testState, setTestState] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!settings) {
    return <p className="p-4 text-fg-muted">Loading settings…</p>;
  }

  const providerId = settings.activeProvider;
  const provider = settings.providers[providerId];

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const runTest = async () => {
    setTesting(true);
    setTestState("Testing…");
    await save({}); // ensure latest settings persisted before call
    try {
      const port = chrome.runtime.connect({ name: "chat" });
      port.postMessage({
        ns: "tba",
        v: 1,
        type: "LLM_CHAT",
        reqId: "test",
        payload: {
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          model: settings.perRoleModel.step,
        },
      });
      let out = "";
      const onMsg = (env: ChatTestPortEnv) => {
        if (env.type === "chat-event" && env.event?.type === "text-delta") {
          out += env.event.text ?? "";
          setTestState(out);
        } else if (env.type === "error") {
          setTestState(`❌ ${env.message}`);
          cleanup();
        } else if (env.type === "chat-event" && env.event?.type === "done") {
          setTestState(out.trim() ? `✅ ${out}` : "✅ Provider reachable");
          cleanup();
        }
      };
      port.onMessage.addListener(onMsg);
      function cleanup() {
        port.onMessage.removeListener(onMsg);
        setTesting(false);
      }
    } catch (e) {
      setTestState(`❌ ${String((e as Error)?.message ?? e)}`);
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-4 text-sm">
      <Section title="Provider">
        <div className="flex flex-wrap items-center gap-2">
          {Object.keys(settings.providers).map((id) => (
            <button
              key={id}
              onClick={() => void save({ activeProvider: id })}
              className={`rounded-lg border px-2.5 py-1 font-medium transition-colors duration-150 ${
                id === providerId
                  ? "border-accent bg-bg-elev text-accent"
                  : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Base URL</span>
          <input
            className="rounded-lg border border-border bg-bg px-2 py-1.5"
            value={provider.baseUrl}
            onChange={(e) =>
              void save({
                providers: {
                  ...settings.providers,
                  [providerId]: { ...provider, baseUrl: e.target.value },
                },
              })
            }
          />
        </label>
        <ApiKeyRow providerId={providerId} refValue={provider.apiKeyRef} onSaved={flashSaved} />
        {saved && <span className="text-xs text-success">Saved.</span>}
      </Section>

      <Section title="Models per role">
        <ModelInput
          label="Planner (stronger reasoning for teaching/deciding)"
          value={settings.perRoleModel.planner}
          onChange={(v) => void save({ perRoleModel: { ...settings.perRoleModel, planner: v } })}
        />
        <ModelInput
          label="Step execution (fast, cheap)"
          value={settings.perRoleModel.step}
          onChange={(v) => void save({ perRoleModel: { ...settings.perRoleModel, step: v } })}
        />
        <ModelInput
          label="Vision (optional, off in v1)"
          value={settings.perRoleModel.vision ?? ""}
          onChange={(v) =>
            void save({
              perRoleModel: { ...settings.perRoleModel, vision: v === "" ? null : v },
            })
          }
        />
      </Section>

      <Section title="Test">
        <button
          onClick={() => void runTest()}
          disabled={testing}
          className="self-start rounded-lg bg-accent px-3 py-1.5 font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-40"
        >
          {testing ? "Testing…" : "Test provider"}
        </button>
        {testState && (
          <p className={`rounded-lg bg-bg-elev px-3 py-2 ${testState.startsWith("❌") ? "text-danger" : "text-success"}`}>
            {testState}
          </p>
        )}
      </Section>

      <Section title="Safety limits">
        <NumberInput
          label="Max steps per run"
          value={settings.safety.maxStepsPerRun}
          onChange={(v) =>
            void save({ safety: { ...settings.safety, maxStepsPerRun: clamp(v, 1, 500) } })
          }
        />
        <NumberInput
          label="Max items per batch"
          value={settings.safety.maxItemsPerBatch}
          onChange={(v) =>
            void save({ safety: { ...settings.safety, maxItemsPerBatch: clamp(v, 1, 2000) } })
          }
        />
        <NumberInput
          label="Delay between batch items (ms)"
          value={settings.safety.interItemDelayMs}
          onChange={(v) =>
            void save({ safety: { ...settings.safety, interItemDelayMs: clamp(v, 0, 10000) } })
          }
        />
        <label className="mt-1 flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.safety.canaryFirst}
            onChange={(e) =>
              void save({ safety: { ...settings.safety, canaryFirst: e.target.checked } })
            }
          />
          <span>Canary first for destructive actions</span>
        </label>
      </Section>

      <Section title="Sites">
        <SitesSection />
      </Section>

      <Section title="Appearance">
        <div className="flex gap-2">
          {(["system", "light", "dark"] as const).map((t) => (
            <button
              key={t}
              onClick={() => void save({ appearance: { ...settings.appearance, theme: t } })}
              className={`rounded-lg border px-2.5 py-1 ${
                t === settings.appearance.theme
                  ? "border-accent text-accent"
                  : "border-border text-fg-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>

      <p className="rounded-lg bg-bg-elev p-3 text-xs text-fg-muted">
        Nothing leaves this browser except calls to <code>{provider.baseUrl}</code>. Keys are stored
        locally and never injected into pages (docs/10).
      </p>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
}

function ModelInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        className="rounded-lg border border-border bg-bg px-2 py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </label>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <input
        type="number"
        className="w-24 rounded-lg border border-border bg-bg px-2 py-1 text-right"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function SiteGrantRow({
  origin,
  granted,
}: {
  origin: string;
  granted: boolean;
}) {
  return (
    <span
      className={`rounded-lg px-2 py-0.5 text-[11px] ${
        granted ? "bg-success text-white" : "bg-bg-elev text-fg-muted"
      }`}
    >
      {origin}
    </span>
  );
}

/** Per-site enablement (PRD §7.3): optional host permissions requested at runtime on a
 * user gesture. Grants live in browser permissions + settings.sites for display. */
function SitesSection() {
  const { settings, save } = useSettings();
  const [origin, setOrigin] = useState("");
  const [formifying, setFormifying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const grantedHosts = useMemo(() => {
    if (!settings) return [];
    return settings.sites.filter((s) => s.granted).map((s) => s.host);
  }, [settings]);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const t = tabs[0];
      if (t?.url && /^https?:/i.test(t.url)) {
        try {
          setOrigin(new URL(t.url).origin);
        } catch {
          // ignore
        }
      }
    });
  }, []);

  const grant = async () => {
    if (!origin || !settings) return;
    setFormifying(true);
    try {
      const okReq = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (okReq) {
        const sites = settings.sites.filter((s) => !s.host.startsWith(origin));
        await save({
          sites: [...sites, { host: origin, granted: true, cdpFallback: false }],
        });
        setStatus(`Granted: ${origin}`);
      } else {
        setStatus("Grant denied — the agent cannot act on this site.");
      }
    } catch (e) {
      setStatus(`Grant failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setFormifying(false);
    }
  };

  const revoke = async (host: string) => {
    await chrome.permissions.remove({ origins: [`${host}/*`] });
    await save({ sites: (settings ?? DEFAULTS).sites.filter((s) => s.host !== host) });
    setStatus(`Revoked: ${host}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">
            Site to enable (from the active tab)
          </span>
          <input
            className="rounded-lg border border-border bg-bg px-2 py-1.5"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          onClick={() => void grant()}
          disabled={formifying || !origin}
          className="rounded-lg bg-accent px-3 py-1.5 font-medium text-white transition-colors duration-150 hover:bg-accent-strong disabled:opacity-40"
        >
          Enable site
        </button>
      </div>
      {grantedHosts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {grantedHosts.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => void revoke(h)}
              title="Click to revoke"
              className="cursor-pointer"
            >
              <SiteGrantRow origin={h} granted />
            </button>
          ))}
        </div>
      )}
      {status && <span className="text-xs text-fg-muted">{status}</span>}
    </div>
  );
}

function ApiKeyRow({
  providerId,
  refValue,
  onSaved,
}: {
  providerId: string;
  refValue: string | null | undefined;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  // Masked from secrets storage on save; never displayed back.
  const saveKey = async () => {
    const keyId = refValue?.startsWith("key:") ? refValue.slice(4) : providerId;
    try {
      await setSecret(keyId, key === "" ? null : key);
      setKey("");
      setStatus(key === "" ? "Key removed." : "Key saved locally.");
      onSaved();
    } catch (e) {
      setStatus(`Failed: ${String((e as Error)?.message ?? e)}`);
    }
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-fg-muted">
        API key ({refValue ?? `key:${providerId}`}) — stored locally, never sent to pages
      </span>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-border bg-bg px-2 py-1.5"
          value={key}
          type="password"
          placeholder="sk-…"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveKey();
          }}
        />
        <button
          type="button"
          onClick={() => void saveKey()}
          className="rounded-lg border border-border px-2.5 py-1.5 font-medium transition-colors duration-150 hover:border-accent hover:text-accent"
        >
          Save
        </button>
      </div>
      {status && <span className="text-xs text-fg-muted">{status}</span>}
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: import("react").ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>
      {children}
    </section>
  );
}
