import { useState } from 'react';
import { useSettings } from '../stores/settingsStore';
import { useChat } from '../stores/chatStore';
import { X, Check, AlertCircle, Loader2, Save, Eye, EyeOff, Zap } from 'lucide-react';

const MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'CTO reasoning — Anthropic API key', color: 'bg-purple' },
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4', desc: 'UI/design — Anthropic API key', color: 'bg-accent' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fast triage — Anthropic API key', color: 'bg-green' },
  { id: 'gpt-5.3-codex', label: 'GPT 5.3 Codex', desc: 'Code gen — ChatGPT auth (Codex CLI)', color: 'bg-yellow' },
  { id: 'gpt-5.2', label: 'GPT 5.2', desc: 'General agentic — OpenAI API key', color: 'bg-yellow' },
  { id: 'o3', label: 'o3', desc: 'Reasoning — OpenAI API key', color: 'bg-yellow' },
];

export function SettingsPanel() {
  const settings = useSettings();
  const chatStore = useChat();
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [verifyingAnthropic, setVerifyingAnthropic] = useState(false);
  const [verifyingOpenai, setVerifyingOpenai] = useState(false);
  const [saved, setSaved] = useState(false);

  const verifyAnthropic = async () => {
    if (!settings.anthropicKey) return;
    setVerifyingAnthropic(true);
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: settings.anthropicKey }),
      });
      const data = await res.json();
      settings.update({ anthropicKeyValid: data.valid });
    } catch {
      settings.update({ anthropicKeyValid: false });
    }
    setVerifyingAnthropic(false);
  };

  const verifyOpenai = async () => {
    if (!settings.openaiKey) return;
    setVerifyingOpenai(true);
    try {
      const res = await fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'openai', apiKey: settings.openaiKey }),
      });
      const data = await res.json();
      settings.update({ openaiKeyValid: data.valid });
    } catch {
      settings.update({ openaiKeyValid: false });
    }
    setVerifyingOpenai(false);
  };

  const handleSave = () => {
    settings.saveToStorage();
    chatStore.setApiKey(settings.anthropicKey);
    chatStore.setModel(settings.defaultModel);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const KeyStatus = ({ valid }: { valid: boolean | null }) => {
    if (valid === null) return null;
    return valid
      ? <Check className="w-4 h-4 text-green" />
      : <AlertCircle className="w-4 h-4 text-red" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-base rounded-xl shadow-2xl w-[520px] max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent" />
            <h2 className="text-sm font-bold text-text">GiuseCoder Settings</h2>
          </div>
          <button onClick={() => settings.setOpen(false)} className="p-1 text-muted hover:text-text rounded hover:bg-overlay">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6">
          {/* ── API Keys ── */}
          <Section title="API Keys">
            {/* Anthropic */}
            <label className="block text-xs text-muted mb-1 font-medium">Anthropic API Key</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={settings.anthropicKey}
                  onChange={(e) => settings.update({ anthropicKey: e.target.value, anthropicKeyValid: null })}
                  placeholder="sk-ant-..."
                  className="w-full bg-overlay border border-base rounded px-3 py-2 text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-accent/50 pr-8"
                />
                <button onClick={() => setShowAnthropicKey(!showAnthropicKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                  {showAnthropicKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                onClick={verifyAnthropic}
                disabled={!settings.anthropicKey || verifyingAnthropic}
                className="px-3 py-2 bg-overlay border border-base rounded text-xs text-muted hover:text-text hover:border-accent/50 disabled:opacity-30 flex items-center gap-1"
              >
                {verifyingAnthropic ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyStatus valid={settings.anthropicKeyValid} />}
                Verify
              </button>
            </div>
            {settings.anthropicKeyValid === true && <p className="text-[10px] text-green mt-1">Key verified successfully</p>}
            {settings.anthropicKeyValid === false && <p className="text-[10px] text-red mt-1">Invalid key — check and retry</p>}

            {/* OpenAI */}
            <label className="block text-xs text-muted mb-1 font-medium mt-3">OpenAI API Key (for Codex)</label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type={showOpenaiKey ? 'text' : 'password'}
                  value={settings.openaiKey}
                  onChange={(e) => settings.update({ openaiKey: e.target.value, openaiKeyValid: null })}
                  placeholder="sk-proj-..."
                  className="w-full bg-overlay border border-base rounded px-3 py-2 text-xs text-text placeholder:text-muted/40 focus:outline-none focus:border-accent/50 pr-8"
                />
                <button onClick={() => setShowOpenaiKey(!showOpenaiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                  {showOpenaiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                onClick={verifyOpenai}
                disabled={!settings.openaiKey || verifyingOpenai}
                className="px-3 py-2 bg-overlay border border-base rounded text-xs text-muted hover:text-text hover:border-accent/50 disabled:opacity-30 flex items-center gap-1"
              >
                {verifyingOpenai ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyStatus valid={settings.openaiKeyValid} />}
                Verify
              </button>
            </div>
            {settings.openaiKeyValid === true && <p className="text-[10px] text-green mt-1">Key verified successfully</p>}
            {settings.openaiKeyValid === false && <p className="text-[10px] text-red mt-1">Invalid key — check and retry</p>}
          </Section>

          {/* ── Default Model ── */}
          <Section title="Default Model">
            <div className="space-y-1.5">
              {MODELS.map(m => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 p-2.5 rounded cursor-pointer border transition-all ${
                    settings.defaultModel === m.id ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:bg-overlay'
                  }`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={m.id}
                    checked={settings.defaultModel === m.id}
                    onChange={() => settings.update({ defaultModel: m.id })}
                    className="hidden"
                  />
                  <div className={`w-2.5 h-2.5 rounded-full ${m.color}`} />
                  <div>
                    <p className="text-xs font-medium text-text">{m.label}</p>
                    <p className="text-[10px] text-muted">{m.desc}</p>
                  </div>
                  {settings.defaultModel === m.id && <Check className="w-4 h-4 text-accent ml-auto" />}
                </label>
              ))}
            </div>
          </Section>

          {/* ── Orchestration ── */}
          <Section title="Orchestration">
            <Toggle label="Auto-Run (fully automatic)" desc="AI executes tasks without confirmation" value={settings.autoRun} onChange={(v) => settings.update({ autoRun: v })} />
            <Toggle label="Multi-Agent Orchestrator" desc="Haiku triage → Opus plan → Sonnet design + Codex code → Opus review" value={settings.orchestratorEnabled} onChange={(v) => settings.update({ orchestratorEnabled: v })} />
            <Toggle label="Auto-Review" desc="Opus automatically reviews generated code" value={settings.autoReview} onChange={(v) => settings.update({ autoReview: v })} />
            <Toggle label="Auto-Fix" desc="Re-run code generation to fix critical issues" value={settings.autoFix} onChange={(v) => settings.update({ autoFix: v })} />
            <Toggle label="Parallel Execution" desc="Run design + code steps in parallel" value={settings.parallelExecution} onChange={(v) => settings.update({ parallelExecution: v })} />
          </Section>

          {/* ── Advanced ── */}
          <Section title="Advanced">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted mb-1 block">Temperature</label>
                <input
                  type="number"
                  min={0} max={1} step={0.1}
                  value={settings.temperature}
                  onChange={(e) => settings.update({ temperature: parseFloat(e.target.value) })}
                  className="w-full bg-overlay border border-base rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted mb-1 block">Max Tokens</label>
                <input
                  type="number"
                  min={256} max={32768} step={256}
                  value={settings.maxTokens}
                  onChange={(e) => settings.update({ maxTokens: parseInt(e.target.value) })}
                  className="w-full bg-overlay border border-base rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted mb-1 block">Max Fix Rounds</label>
                <input
                  type="number"
                  min={0} max={3}
                  value={settings.maxFixRounds}
                  onChange={(e) => settings.update({ maxFixRounds: parseInt(e.target.value) })}
                  className="w-full bg-overlay border border-base rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted mb-1 block">Cost Warning ($)</label>
                <input
                  type="number"
                  min={0} step={0.1}
                  value={settings.costWarningThreshold}
                  onChange={(e) => settings.update({ costWarningThreshold: parseFloat(e.target.value) })}
                  className="w-full bg-overlay border border-base rounded px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent/50"
                />
              </div>
            </div>
          </Section>
        </div>

        {/* Footer — Save */}
        <div className="px-5 py-3 border-t border-base sticky bottom-0 bg-surface flex items-center justify-between">
          <p className="text-[10px] text-muted">Settings saved to localStorage</p>
          <button
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium transition-all ${
              saved ? 'bg-green/20 text-green' : 'bg-accent hover:bg-accent/80 text-base'
            }`}
          >
            {saved ? <><Check className="w-3.5 h-3.5" /> Saved!</> : <><Save className="w-3.5 h-3.5" /> Save Settings</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold text-accent uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-base/50 last:border-0">
      <div>
        <p className="text-xs text-text">{label}</p>
        <p className="text-[10px] text-muted">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors relative ${value ? 'bg-accent' : 'bg-overlay'}`}
      >
        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
