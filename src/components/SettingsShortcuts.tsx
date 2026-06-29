import { sectionTitle, label, kbdStyle } from "../styles/settings";

interface ShortcutGroup {
  title: string;
  entries: { keys: string; action: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "全局",
    entries: [
      { keys: "Ctrl + ,", action: "打开设置" },
      { keys: "/", action: "搜索系列" },
      { keys: "Ctrl + K", action: "搜索系列（同上）" },
    ],
  },
  {
    title: "首页",
    entries: [
      { keys: "← →", action: "切换系列" },
      { keys: "Enter", action: "进入系列详情 / 继续播放" },
      { keys: "鼠标滚轮", action: "切换系列" },
    ],
  },
  {
    title: "搜索",
    entries: [
      { keys: "Esc", action: "关闭搜索" },
      { keys: "↑ ↓", action: "导航搜索结果" },
      { keys: "Enter", action: "打开选中系列" },
    ],
  },
  {
    title: "详情页",
    entries: [
      { keys: "Esc", action: "关闭弹窗 / 返回首页" },
    ],
  },
  {
    title: "播放页",
    entries: [
      { keys: "Space", action: "播放 / 暂停" },
      { keys: "← →", action: "后退 / 前进 5 秒" },
      { keys: "↑ ↓", action: "音量 +5 / -5" },
      { keys: "F", action: "全屏切换" },
      { keys: "Esc", action: "关闭选集面板 / 退出全屏 / 返回" },
      { keys: "M", action: "静音切换" },
      { keys: "[ ]", action: "减速 / 加速" },
      { keys: "P", action: "上一集" },
      { keys: "N", action: "下一集" },
      { keys: "J", action: "切换字幕轨" },
      { keys: "双击画面", action: "切换全屏" },
    ],
  },
  {
    title: "弹窗与浮层",
    entries: [
      { keys: "Esc", action: "关闭当前弹窗 / 浮层" },
      { keys: "点击遮罩", action: "关闭当前弹窗" },
    ],
  },
];

export default function SettingsShortcuts() {
  return (
    <>
      <h2 style={sectionTitle}>快捷键</h2>

      {GROUPS.map((group, gi) => (
        <div key={group.title} style={{ marginBottom: gi < GROUPS.length - 1 ? 28 : 0 }}>
          <label style={label}>{group.title}</label>
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-surface-elevated)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {group.entries.map((entry) => (
                <div
                  key={entry.keys + entry.action}
                  style={{ display: "flex", alignItems: "center", gap: 14 }}
                >
                  <kbd style={kbdStyle}>{entry.keys}</kbd>
                  <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                    {entry.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
