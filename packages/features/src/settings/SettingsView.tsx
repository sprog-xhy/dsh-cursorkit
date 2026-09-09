/**
 * Settings page (M3 platformization, doc §M3).
 *
 * Tabs: 模型 / MCP / 插件 / Skills / 关于.
 * Data comes from CKP RPC (model.list, mcp.list, plugin.list, skill.list,
 * config.get). API keys are Keychain-managed by the desktop shell — this page
 * only displays whether a key is configured via config.get, never plaintext.
 *
 * @module @dsh-cursorkit/features/settings
 */

import { useEffect, useState } from 'react';
import type { CkpClient } from '@dsh-cursorkit/client';
import type { Config, McpServerInfo, ModelInfo, PluginInfo, SkillInfo } from '@dsh-cursorkit/protocol';
import { Badge, Card } from '@dsh-cursorkit/ui-kit';

export type SettingsTab = 'models' | 'mcp' | 'plugins' | 'skills' | 'about';

export interface SettingsViewProps {
  client: CkpClient;
}

export function SettingsView({ client }: SettingsViewProps) {
  const [tab, setTab] = useState<SettingsTab>('models');
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    void client.call('config.get', {}).then(setConfig).catch(() => setConfig(null));
  }, [client]);

  return (
    <div style={styles.page}>
      <div style={styles.tabs}>
        {(['models', 'mcp', 'plugins', 'skills', 'about'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={styles.body}>
        {tab === 'models' && <ModelsTab client={client} />}
        {tab === 'mcp' && <McpTab client={client} />}
        {tab === 'plugins' && <PluginsTab client={client} />}
        {tab === 'skills' && <SkillsTab client={client} />}
        {tab === 'about' && <AboutTab config={config} />}
      </div>
    </div>
  );
}

function TabCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 style={styles.cardTitle}>{title}</h3>
      {children}
    </Card>
  );
}

function ModelsTab({ client }: { client: CkpClient }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    void client.call('model.list', {}).then(setModels).catch(() => setModels([]));
  }, [client]);

  return (
    <TabCard title="模型">
      {models.length === 0 ? (
        <p style={styles.hint}>
          host 未暴露模型列表（capability 缺失时置灰）。API Key 由桌面壳 Keychain 管理，绝不明文落盘。
        </p>
      ) : (
        <ul style={styles.list}>
          {models.map((m) => (
            <li key={m.id} style={styles.row}>
              <span>{m.name}</span>
              {m.provider && <Badge tone="blue">{m.provider}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </TabCard>
  );
}

function McpTab({ client }: { client: CkpClient }) {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  useEffect(() => {
    void client.call('mcp.list', {}).then(setServers).catch(() => setServers([]));
  }, [client]);

  return (
    <TabCard title="MCP 服务器">
      {servers.length === 0 ? (
        <p style={styles.hint}>暂无 MCP 服务器。可在 host 配置中添加（mcp.add）。</p>
      ) : (
        <ul style={styles.list}>
          {servers.map((s) => (
            <li key={s.id} style={styles.row}>
              <span>{s.name}</span>
              <Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? '启用' : '停用'}</Badge>
              <span style={styles.muted}>{s.transport}</span>
            </li>
          ))}
        </ul>
      )}
    </TabCard>
  );
}

function PluginsTab({ client }: { client: CkpClient }) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  useEffect(() => {
    void client.call('plugin.list', {}).then(setPlugins).catch(() => setPlugins([]));
  }, [client]);

  return (
    <TabCard title="插件">
      {plugins.length === 0 ? (
        <p style={styles.hint}>host 未暴露插件清单（capability 缺失）。</p>
      ) : (
        <ul style={styles.list}>
          {plugins.map((p) => (
            <li key={p.id} style={styles.row}>
              <span>{p.name}</span>
              {p.version && <Badge tone="neutral">{p.version}</Badge>}
              <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? '启用' : '停用'}</Badge>
            </li>
          ))}
        </ul>
      )}
    </TabCard>
  );
}

function SkillsTab({ client }: { client: CkpClient }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  useEffect(() => {
    void client.call('skill.list', {}).then(setSkills).catch(() => setSkills([]));
  }, [client]);

  return (
    <TabCard title="Skills">
      {skills.length === 0 ? (
        <p style={styles.hint}>host 未暴露 skills 清单（capability 缺失）。</p>
      ) : (
        <ul style={styles.list}>
          {skills.map((s) => (
            <li key={s.id} style={styles.row}>
              <span>{s.name}</span>
              {s.description && <span style={styles.muted}>{s.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </TabCard>
  );
}

function AboutTab({ config }: { config: Config | null }) {
  return (
    <TabCard title="关于">
      <div style={styles.about}>
        <p><strong>dsh-cursorkit</strong> — DeepSeek Harness 桌面客户端（CKP 协议）</p>
        <p style={styles.muted}>当前 profile: {config?.profile ?? '未知'}</p>
        <p style={styles.muted}>默认模型: {config?.model ?? '未知'}</p>
        <p style={styles.muted}>工作区: {config?.workspace ?? '未知'}</p>
      </div>
    </TabCard>
  );
}

const styles: Record<string, React.CSSProperties> = {
  cardTitle: { fontSize: 14, fontWeight: 600, margin: '0 0 10px', color: '#111827' },
  page: { flex: 1, display: 'flex', flexDirection: 'column', padding: 20, overflowY: 'auto' },
  tabs: { display: 'flex', gap: 4, marginBottom: 16 },
  tab: { border: 'none', background: 'none', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#6b7280' },
  tabActive: { backgroundColor: '#eef2ff', color: '#4338ca', fontWeight: 600 },
  body: { maxWidth: 640 },
  list: { listStyle: 'none', padding: 0, margin: 0 },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 },
  hint: { color: '#9ca3af', fontSize: 13 },
  muted: { color: '#9ca3af', fontSize: 12.5 },
  about: { fontSize: 13, lineHeight: 1.7 },
};
