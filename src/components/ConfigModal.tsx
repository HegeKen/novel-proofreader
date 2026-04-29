// ============================================================
// AI 模型配置弹窗 - Apple Liquid Glass Design
// ============================================================
import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AIProvider } from '../types';

const PROVIDERS: { value: AIProvider; label: string; icon: string; color: string }[] = [
  { value: 'openai', label: 'OpenAI', icon: '🤖', color: '#10a37f' },
  { value: 'deepseek', label: 'DeepSeek', icon: '🔮', color: '#4d6bfe' },
  { value: 'siliconflow', label: 'SiliconFlow', icon: '⚡', color: '#f59e0b' },
  { value: 'mimo', label: 'Xiaomi MiMo', icon: '🎯', color: '#ff6900' },
  { value: 'lmstudio', label: 'LM Studio', icon: '💻', color: '#6366f1' },
  { value: 'custom', label: '自定义', icon: '⚙️', color: '#6b7280' },
];

const PRESETS: Record<AIProvider, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  mimo: { baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2-flash' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1', model: '' },
  custom: { baseUrl: '', model: '' },
};

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ConfigState {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  enableLogging: boolean;
}

// 根据 URL 检测提供商
const detectProvider = (url: string): AIProvider => {
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('openai')) return 'openai';
  if (url.includes('siliconflow')) return 'siliconflow';
  if (url.includes('xiaomimimo')) return 'mimo';
  if (url.includes('localhost:1234') || url.includes('127.0.0.1:1234')) return 'lmstudio';
  return 'custom';
};

// 内部组件，使用 key 重置状态
function ConfigModalContent({
  initialConfig,
  apiKeyMap,
  onSave,
  onClose,
}: {
  initialConfig: ConfigState;
  apiKeyMap: Partial<Record<AIProvider, string>>;
  onSave: (config: ConfigState) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ConfigState>(initialConfig);

  const handleProviderChange = useCallback((p: AIProvider) => {
    setConfig((prev) => ({
      ...prev,
      provider: p,
      baseUrl: PRESETS[p].baseUrl,
      model: PRESETS[p].model,
      apiKey: apiKeyMap[p] ?? '',
    }));
  }, [apiKeyMap]);

  const handleSave = useCallback(() => {
    onSave(config);
  }, [config, onSave]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <div className="config-title">
            <span className="title-icon">⚙️</span>
            <span>AI 模型配置</span>
          </div>
          <button className="close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3L13 13M13 3L3 13" />
            </svg>
          </button>
        </div>

        <div className="config-body">
          <div className="config-section">
            <div className="section-label">选择模型提供商</div>
            <div className="provider-grid">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  className={`provider-card ${config.provider === p.value ? 'active' : ''}`}
                  onClick={() => handleProviderChange(p.value)}
                  style={{
                    '--provider-color': p.color,
                  } as React.CSSProperties}
                >
                  <span className="provider-icon">{p.icon}</span>
                  <span className="provider-name">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="config-section">
            <div className="section-label">API 配置</div>
            <div className="form-field">
              <label>Base URL</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  value={config.baseUrl}
                  onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                  className="config-input"
                />
              </div>
            </div>

            <div className="form-field">
              <label>API Key</label>
              <div className="input-wrapper">
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="config-input"
                />
              </div>
            </div>

            <div className="form-field">
              <label>模型名称</label>
              <div className="input-wrapper">
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="deepseek-chat"
                  className="config-input"
                />
              </div>
            </div>
          </div>

          <div className="config-section">
            <div className="section-label">调试选项</div>
            <label className="toggle-label">
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={config.enableLogging}
                  onChange={(e) => setConfig((prev) => ({ ...prev, enableLogging: e.target.checked }))}
                />
                <span className="toggle-slider"></span>
              </div>
              <span className="toggle-text">开启调试日志</span>
            </label>
          </div>
        </div>

        <div className="config-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave}>保存配置</button>
        </div>
      </div>
    </div>
  );
}

export function ConfigModal({ open, onClose }: Props) {
  const aiConfig = useAppStore((s) => s.aiConfig);
  const setAIConfig = useAppStore((s) => s.setAIConfig);
  const apiKeyMap = useAppStore((s) => s.apiKeyMap);
  const setApiKeyForProvider = useAppStore((s) => s.setApiKeyForProvider);

  // 计算初始配置
  const provider = detectProvider(aiConfig.baseURL);
  const initialConfig: ConfigState = {
    provider,
    baseUrl: aiConfig.baseURL,
    apiKey: apiKeyMap[provider] ?? aiConfig.apiKey,
    model: aiConfig.model,
    enableLogging: aiConfig.enableLogging,
  };

  // 保存配置的回调
  const handleSave = useCallback((config: ConfigState) => {
    setApiKeyForProvider(config.provider, config.apiKey);
    setAIConfig({
      baseURL: config.baseUrl.replace(/\/+$/, ''),
      apiKey: config.apiKey,
      model: config.model,
      enableLogging: config.enableLogging,
    });
    onClose();
  }, [setApiKeyForProvider, setAIConfig, onClose]);

  if (!open) return null;

  // 使用 key 属性确保每次打开弹窗时重新挂载组件，从而重置状态
  return (
    <ConfigModalContent
      key={open ? 'open' : 'closed'}
      initialConfig={initialConfig}
      apiKeyMap={apiKeyMap}
      onSave={handleSave}
      onClose={onClose}
    />
  );
}
