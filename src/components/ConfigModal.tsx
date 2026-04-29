// ============================================================
// AI 模型配置弹窗 - Apple Liquid Glass Design
// ============================================================
import { useState } from 'react';
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

export function ConfigModal({ open, onClose }: Props) {
  const aiConfig = useAppStore((s) => s.aiConfig);
  const setAIConfig = useAppStore((s) => s.setAIConfig);
  const apiKeyMap = useAppStore((s) => s.apiKeyMap);
  const setApiKeyForProvider = useAppStore((s) => s.setApiKeyForProvider);

  // 辅助函数：根据当前 store 状态计算初始配置
  const getInitialConfig = () => {
    const url = aiConfig.baseURL;
    let detected: AIProvider = 'custom';
    if (url.includes('deepseek')) detected = 'deepseek';
    else if (url.includes('openai')) detected = 'openai';
    else if (url.includes('siliconflow')) detected = 'siliconflow';
    else if (url.includes('xiaomimimo')) detected = 'mimo';
    else if (url.includes('localhost:1234') || url.includes('127.0.0.1:1234')) detected = 'lmstudio';

    return {
      provider: detected,
      baseUrl: url,
      apiKey: apiKeyMap[detected] ?? aiConfig.apiKey,
      model: aiConfig.model,
      enableLogging: aiConfig.enableLogging,
    };
  };
  if (!open) return null;

  const ModalContent = () => {
    const [config, setConfig] = useState(getInitialConfig);

    const handleProviderChange = (p: AIProvider) => {
      setConfig({
        ...config,
        provider: p,
        baseUrl: PRESETS[p].baseUrl,
        model: PRESETS[p].model,
        apiKey: apiKeyMap[p] ?? '',
      });
    };

    const handleSave = () => {
      setApiKeyForProvider(config.provider, config.apiKey);
      setAIConfig({
        baseURL: config.baseUrl.replace(/\/+$/, ''),
        apiKey: config.apiKey,
        model: config.model,
        enableLogging: config.enableLogging,
      });
      onClose();
    };

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
                    onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
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
                    onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
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
                    onChange={(e) => setConfig({ ...config, model: e.target.value })}
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
                    onChange={(e) => setConfig({ ...config, enableLogging: e.target.checked })}
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
  };

  // 使用 key 确保每次打开弹窗时都重新挂载内部组件，从而获取最新的初始状态
  return <ModalContent key={open ? 'open' : 'closed'} />;
}