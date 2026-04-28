// ============================================================
// AI 模型配置弹窗（按提供商独立存储 API Key）
// ============================================================
import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AIProvider } from '../types';

const PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'siliconflow', label: 'SiliconFlow' },
  { value: 'mimo', label: 'Xiaomi MiMo' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'custom', label: '自定义' },
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

  const [provider, setProvider] = useState<AIProvider>('deepseek');
  const [baseUrl, setBaseUrl] = useState(aiConfig.baseURL);
  const [apiKey, setApiKey] = useState(aiConfig.apiKey);
  const [model, setModel] = useState(aiConfig.model);
  const [enableLogging, setEnableLogging] = useState(aiConfig.enableLogging);

  // 弹窗打开时用最新配置初始化
  useEffect(() => {
    if (open) {
      // 根据当前 baseURL 推断 provider
      const url = aiConfig.baseURL;
      let detected: AIProvider = 'custom';
      if (url.includes('deepseek')) detected = 'deepseek';
      else if (url.includes('openai')) detected = 'openai';
      else if (url.includes('siliconflow')) detected = 'siliconflow';
      else if (url.includes('xiaomimimo')) detected = 'mimo';
      else if (url.includes('localhost:1234') || url.includes('127.0.0.1:1234')) detected = 'lmstudio';

      setProvider(detected);
      setBaseUrl(url);
      // 从 apiKeyMap 读取该提供商的 key，兜底用 aiConfig.apiKey
      setApiKey(apiKeyMap[detected] ?? aiConfig.apiKey);
      setModel(aiConfig.model);
      setEnableLogging(aiConfig.enableLogging);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleProviderChange = (p: AIProvider) => {
    setProvider(p);
    setBaseUrl(PRESETS[p].baseUrl);
    setModel(PRESETS[p].model);
    // 切换提供商时，从 apiKeyMap 加载对应的 key
    setApiKey(apiKeyMap[p] ?? '');
  };

  const handleSave = () => {
    // 保存当前提供商的 API Key 到 apiKeyMap
    setApiKeyForProvider(provider, apiKey);
    // 同步更新 aiConfig（当前生效的配置）
    setAIConfig({
      baseURL: baseUrl.replace(/\/+$/, ''),
      apiKey,
      model,
      enableLogging,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>AI 模型配置</h2>

        <div className="form-group">
          <label>模型提供商</label>
          <div className="provider-grid">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                className={`provider-btn ${provider === p.value ? 'active' : ''}`}
                onClick={() => handleProviderChange(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>API Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </div>

        <div className="form-group">
          <label>模型名称</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
          />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enableLogging}
              onChange={(e) => setEnableLogging(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            开启调试日志（输出到浏览器控制台）
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
