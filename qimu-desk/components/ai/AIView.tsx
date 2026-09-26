"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  App,
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TextAreaRef } from "antd/es/input/TextArea";
import composerStyles from "./AIComposer.module.css";
import CapabilitiesDrawer from "@/components/ai/CapabilitiesDrawer";
import ToolActivity from "@/components/ai/ToolActivity";
import type { CapabilitySummary, ToolRun } from "@/core/ai/capability-schema";
import ChatMarkdown from "@/components/ai/ChatMarkdown";
import DraftCard, { type DraftCardHandle } from "@/components/ai/DraftCard";
import type { ChatDraft, SaveResult } from "@/core/ai/artifacts";
import { QUICK_TEMPLATES } from "@/core/ai/commands";
import {
  SlashCommandSource,
  loadRecent,
  pushRecent,
  GROUP_TITLES,
  type SlashGroup,
  type SlashItem,
} from "@/core/ai/slashCommands";
import SlashCommandMenu from "@/components/ai/SlashCommandMenu";
import { adminUrl } from "@/core/admin-url";
import {
  ApiOutlined,
  ArrowUpOutlined,
  BookOutlined,
  BulbOutlined,
  CaretDownOutlined,
  ClearOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  DownloadOutlined,
  DislikeFilled,
  DislikeOutlined,
  LikeFilled,
  LikeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PartitionOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";

const { TextArea } = Input;
const { Text } = Typography;

// ============ 类型 ============

type ChatItem = {
  role: "user" | "assistant";
  content: string;
  usedDocs?: { id: number; title: string }[];
  usedCapabilities?: { id: number; name: string }[];
  allowToolCalls?: boolean;
  toolRuns?: ToolRun[];
  gatewayId?: number;
  gatewayName?: string;
  model?: string;
  drafts?: ChatDraft[];
  saveResults?: SaveResult[];
  /** 点赞 / 点踩（仅本地持久化） */
  feedback?: "up" | "down";
  /** 是否为错误提示消息（错误消息不展示操作按钮） */
  error?: boolean;
  /** 引用的技能（description 仅用于随消息传给后端重建跨轮引用上下文，不参与 UI 展示） */
  usedSkills?: { id: number; name: string; displayName: string; description?: string }[];
  /** 引用的工作流（同上） */
  usedWorkflows?: { id: number; name: string; displayName: string; description?: string }[];
};

/** 技能/工作流引用 */
type ItemRef = { id: number; name: string; displayName: string; description?: string };

/** send 的可选附加参数（用于命令面板「加入并发送 / 运行」场景，避免依赖异步 state） */
type SendExtra = {
  /** 显式指定技能 id（覆盖当前 selectedSkills） */
  skillIds?: number[];
  /** 显式指定工作流 id（覆盖当前 selectedWorkflows） */
  workflowIds?: number[];
  /** 用于消息卡片展示的引用对象（覆盖当前 selectedSkills） */
  usedSkills?: ItemRef[];
  /** 用于消息卡片展示的引用对象（覆盖当前 selectedWorkflows） */
  usedWorkflows?: ItemRef[];
  /** 显式文本（覆盖当前输入框内容，避免读取到尚未生效的 setState） */
  text?: string;
};

/** 一次会话（DeepSeek 风格：多条对话并存，标题自动取首条用户消息） */
type Conv = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  items: ChatItem[];
};

type Gateway = {
  id: number;
  name: string;
  provider: string;
  base_url: string;
  api_key: string; // 已是打码形态
  model: string;
  temperature: number;
  enabled: boolean;
  is_default: boolean;
  updated_at: string | null;
};

// ============ 常量 ============

const LS_GATEWAY_KEY = "alon:chat:gatewayId";
const LS_RAIL_KEY = "alon:chat:railOpen";
const LS_USE_KNOWLEDGE_KEY = "alon:chat:useKnowledge";
// 会话数据按登录用户隔离：key 携带用户 id，避免不同账号在同一浏览器下共享记录
const sessionKeyOf = (userId: number) => `alon:chat:sessions:u${userId}`;
const activeKeyOf = (userId: number) => `alon:chat:activeId:u${userId}`;
// 旧版无用户隔离的固定 key（仅一次性迁移到当前用户名下用）
const LS_LEGACY_SESSIONS_KEY = "alon:chat:sessions";
const LS_LEGACY_ACTIVE_KEY = "alon:chat:activeId";
const LS_LEGACY_HISTORY_KEY = "alon:chat:history"; // v1 单会话键（仅迁移用）
const MAX_CONVS = 30;
const MAX_CHAT_ITEMS = 100;
/** 单次上送给网关的最近消息数（本地完整保留，超出部分不重复进上下文） */
const SEND_TRIM = 40;

// 居中消息列最大宽度（DeepSeek 风格阅读宽度）
const COL_MAX_WIDTH = 1040;
const RAIL_WIDTH = 240;

// 品牌 Logo（与 AppShell 一致，使用 v2 main：圆形紫底小龙 + Qimu 字样）
const BRAND_LOGO_SRC = "/logo-brand.png";

const TEMPLATE_ICON: Record<string, ReactNode> = {
  skill: <CodeOutlined />,
  workflow: <PartitionOutlined />,
  knowledge: <BookOutlined />,
};

// —— 持久化辅助：SSR 期间不访问 localStorage ——
function readLocalStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
function removeLocalStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// —— 结构校验（防 localStorage 损坏导致运行时抛错） ——
function isValidDraft(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const d = item as Record<string, unknown>;
  if (d.kind !== "skill" && d.kind !== "workflow" && d.kind !== "knowledge") return false;
  if (typeof d.payload !== "object" || d.payload === null) return false;
  return true;
}
function isValidSaveResult(item: unknown): boolean {
  if (typeof item !== "object" || item === null) return false;
  const r = item as Record<string, unknown>;
  if (typeof r.ok !== "boolean") return false;
  if (!r.ok && typeof r.status !== "string") return false;
  if (r.ok && typeof r.id !== "number") return false;
  return true;
}
function isValidChatItem(item: unknown): item is ChatItem {
  if (typeof item !== "object" || item === null) return false;
  const c = item as Record<string, unknown>;
  if (c.role !== "user" && c.role !== "assistant") return false;
  if (typeof c.content !== "string") return false;
  if (c.usedDocs !== undefined) {
    if (!Array.isArray(c.usedDocs)) return false;
    for (const d of c.usedDocs as unknown[]) {
      if (typeof d !== "object" || d === null) return false;
      const doc = d as Record<string, unknown>;
      if (typeof doc.id !== "number") return false;
      if (doc.title !== undefined && typeof doc.title !== "string") return false;
    }
  }
  if (c.usedCapabilities !== undefined && (!Array.isArray(c.usedCapabilities) || !c.usedCapabilities.every((r) => r && typeof r.id === "number" && typeof r.name === "string"))) return false;
  if (c.toolRuns !== undefined && (!Array.isArray(c.toolRuns) || !c.toolRuns.every((r) => r && typeof r.id === "string" && typeof r.name === "string" && ["running", "success", "error"].includes(r.status) && (r.output === undefined || typeof r.output === "string")))) return false;
  for (const key of ["usedSkills", "usedWorkflows"] as const) {
    const refs = c[key];
    if (refs !== undefined && (!Array.isArray(refs) || !refs.every((ref: unknown) => {
      if (!ref || typeof ref !== "object") return false;
      const r = ref as Record<string, unknown>;
      return typeof r.id === "number" && typeof r.name === "string" && typeof r.displayName === "string";
    }))) return false;
  }
  if (c.drafts !== undefined) {
    if (!Array.isArray(c.drafts) || !(c.drafts as unknown[]).every(isValidDraft)) return false;
  }
  if (c.saveResults !== undefined) {
    if (!Array.isArray(c.saveResults) || !(c.saveResults as unknown[]).every(isValidSaveResult)) {
      return false;
    }
  }
  return true;
}
function isValidConv(item: unknown): item is Conv {
  if (typeof item !== "object" || item === null) return false;
  const c = item as Record<string, unknown>;
  if (typeof c.id !== "string") return false;
  if (typeof c.title !== "string") return false;
  if (typeof c.updatedAt !== "number" || !Number.isFinite(c.updatedAt)) return false;
  if (!Array.isArray(c.items) || !c.items.every(isValidChatItem)) return false;
  return true;
}
function loadSessions(storageKey: string): Conv[] | null {
  const raw = readLocalStorage(storageKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.filter(isValidConv).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVS) as Conv[];
  } catch {
    return null;
  }
}
function loadLegacyHistory(storageKey: string): ChatItem[] | null {
  const raw = readLocalStorage(storageKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    if (!parsed.every(isValidChatItem)) return null;
    return parsed.slice(-MAX_CHAT_ITEMS) as ChatItem[];
  } catch {
    return null;
  }
}

function createId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function autoTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

/** 检测输入框当前光标前是否处于「/」指令上下文；命中则返回片段（不含前导 /） */
function detectSlashContext(value: string, cursor: number): { open: boolean; query: string } {
  const before = value.slice(0, cursor);
  const m = before.match(/(^|\s)\/([^\s/]*)$/);
  if (!m) return { open: false, query: "" };
  return { open: true, query: m[2] };
}

/**
 * 移除输入框末尾的「/指令片段」。选中技能/工作流后清理草稿命令，避免其残留在正文中
 * 再次触发面板；若末尾并非指令则原样返回。
 */
function stripTrailingSlashToken(value: string): string {
  const m = value.match(/(^|\s)\/([^\s/]*)$/);
  if (!m) return value;
  return value.slice(0, value.length - m[0].length);
}

/** 流式展示时过滤 <artifacts>…</artifacts> 区段（done 事件回传的 reply 已是剥离版） */
function stripArtifactRegion(text: string): string {
  if (!text.includes("<artifacts")) return text;
  return text.replace(/<artifacts[\s\S]*?<\/artifacts>/g, "").replace(/<artifacts[\s\S]*$/, "").trim();
}

/** 过滤推理模型的 <think>…</think> 思考区段（含流式中尚未闭合的尾部 <think>…） */
function stripThink(text: string): string {
  if (!text.includes("<think>")) return text;
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
}

// 居中列容器样式
const colStyle: CSSProperties = {
  maxWidth: COL_MAX_WIDTH,
  width: "100%",
  margin: "0 auto",
  paddingInline: 16,
  boxSizing: "border-box",
};

/** 品牌头像（与 AppShell 同一份 logo 资源） */
function BrandAvatar({ size = 32, radius = 8 }: { size?: number; radius?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        background: "#fff",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={BRAND_LOGO_SRC}
        alt="Qimu"
        width={size}
        height={size}
        style={{ display: "block", objectFit: "cover", width: "100%", height: "100%" }}
      />
    </div>
  );
}

export default function AIView({ isAdmin }: { isAdmin: boolean }) {
  const { message: appMessage, modal } = App.useApp();

  // —— 网关（chat + settings 共享） ——
  const [gateways, setGateways] = useState<Gateway[] | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [capabilities, setCapabilities] = useState<CapabilitySummary[]>([]);
  const [capabilityIds, setCapabilityIds] = useState<number[]>([]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [capabilitiesError, setCapabilitiesError] = useState("");
  const [allowToolCalls, setAllowToolCalls] = useState(false);
  const [liveToolRuns, setLiveToolRuns] = useState<ToolRun[]>([]);
  const loadCapabilities = useCallback(async () => {
    setCapabilitiesLoading(true); setCapabilitiesError("");
    try {
      const response = await fetch("/api/ai/capabilities", { credentials: "include" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.capabilities)) throw new Error(data.error || "加载 AI 能力失败");
      const list: CapabilitySummary[] = data.capabilities;
      setCapabilities(list);
      setCapabilityIds((ids) => ids.filter((id) => list.some((c) => c.id === id && c.enabled)));
    } catch (error) {
      setCapabilitiesError(error instanceof Error ? error.message : "加载 AI 能力失败");
    } finally { setCapabilitiesLoading(false); }
  }, []);
  useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);
  const [pickedId, setPickedId] = useState<number | null>(null);

  // —— 多会话 ——
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [railOpen, setRailOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  // 当前登录用户 id（会话记录按用户隔离的前提）
  const [userKey, setUserKey] = useState<number | null>(null);

  // —— 输入 / 流式 ——
  const [input, setInput] = useState("");
  const [useKnowledge, setUseKnowledge] = useState(false);

  // —— 「/」内联命令面板 ——
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashGroups, setSlashGroups] = useState<SlashGroup[]>([]);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [streaming, setStreaming] = useState<{ convId: string; text: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const finishStreamRef = useRef<(() => void) | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<TextAreaRef>(null);
  const draftHandles = useRef<Map<string, DraftCardHandle | null>>(new Map());

  // 「/」命令面板：组合输入法状态 / 开关镜像 / 当前输入框镜像
  const isComposingRef = useRef(false);
  const slashOpenRef = useRef(false);
  const slashConsumedRef = useRef(false);
  const inputRef = useRef("");

  // —— 技能/工作流引用 ——
  const [selectedSkills, setSelectedSkills] = useState<ItemRef[]>([]);
  const [selectedWorkflows, setSelectedWorkflows] = useState<ItemRef[]>([]);
  const [skillsList, setSkillsList] = useState<ItemRef[]>([]);
  const [workflowsList, setWorkflowsList] = useState<ItemRef[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);

  // ============ 网关加载 / 选择 ============
  const loadGateways = async () => {
    try {
      const r = await fetch("/api/ai/gateways", { credentials: "include" });
      const d = await r.json();
      if (d.ok) {
        setGateways(d.gateways as Gateway[]);
      } else {
        setGateways([]);
        appMessage.error(d.error || "加载 AI 网关失败");
      }
    } catch {
      setGateways([]);
      appMessage.error("加载 AI 网关失败：网络异常");
    }
  };
  useEffect(() => {
    loadGateways();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 视口宽度 → 是否移动端（<640px 改用底部 Drawer）
  useEffect(() => {
    const update = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < 640);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 让 send 始终读到最新输入框内容（避免命令面板「加入并发送」时读取到过期的 state）
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  useEffect(() => {
    if (!gateways) return;
    if (pickedId && gateways.some((g) => g.id === pickedId && g.enabled)) return;
    const stored = typeof window !== "undefined" ? Number(readLocalStorage(LS_GATEWAY_KEY)) : NaN;
    if (Number.isInteger(stored) && gateways.some((g) => g.id === stored && g.enabled)) {
      setPickedId(stored);
      return;
    }
    const def = gateways.find((g) => g.is_default && g.enabled) || gateways.find((g) => g.enabled);
    setPickedId(def ? def.id : null);
  }, [gateways, pickedId]);

  useEffect(() => {
    if (pickedId && typeof window !== "undefined") {
      writeLocalStorage(LS_GATEWAY_KEY, String(pickedId));
    }
  }, [pickedId]);

  // ============ 加载技能/工作流列表（仅在引用面板展开时） ============
  const loadSkillsList = useCallback(async () => {
    if (skillsList.length > 0) return;
    setSkillsLoading(true);
    try {
      const r = await fetch("/api/skills", { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d.skills)) {
        setSkillsList(d.skills.map((s: { id: number; name: string; displayName: string; description?: string }) => ({
          id: s.id,
          name: s.name,
          displayName: s.displayName || s.name,
          description: s.description,
        })));
      }
    } catch {
      // ignore
    } finally {
      setSkillsLoading(false);
    }
  }, [skillsList.length]);

  const loadWorkflowsList = useCallback(async () => {
    if (workflowsList.length > 0) return;
    setWorkflowsLoading(true);
    try {
      const r = await fetch("/api/workflows", { credentials: "include" });
      const d = await r.json();
      if (Array.isArray(d.workflows)) {
        setWorkflowsList(d.workflows.map((w: { id: number; name: string; displayName: string; description?: string }) => ({
          id: w.id,
          name: w.name,
          displayName: w.displayName || w.name,
          description: w.description,
        })));
      }
    } catch {
      // ignore
    } finally {
      setWorkflowsLoading(false);
    }
  }, [workflowsList.length]);

  useEffect(() => {
    loadSkillsList();
    loadWorkflowsList();
  }, [loadSkillsList, loadWorkflowsList]);

  // ============ 挂载：获取当前用户 → 恢复该用户的会话（含旧版数据一次性迁移） ============
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setUserKey(d?.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 未取到用户身份前不读写任何会话数据，避免串号
    if (userKey == null) return;
    const sk = sessionKeyOf(userKey);
    const ak = activeKeyOf(userKey);
    let sessions = loadSessions(sk);
    let storedActive = readLocalStorage(ak);
    if (!sessions || sessions.length === 0) {
      // 旧版固定 key 中如有历史会话，一次性迁移到当前用户名下并清除
      const legacySessions = loadSessions(LS_LEGACY_SESSIONS_KEY);
      if (legacySessions && legacySessions.length > 0) {
        sessions = legacySessions;
        storedActive = readLocalStorage(LS_LEGACY_ACTIVE_KEY);
        writeLocalStorage(sk, JSON.stringify(legacySessions.slice(0, MAX_CONVS)));
        if (storedActive) writeLocalStorage(ak, storedActive);
        removeLocalStorage(LS_LEGACY_SESSIONS_KEY);
        removeLocalStorage(LS_LEGACY_ACTIVE_KEY);
      }
    }
    if (sessions && sessions.length > 0) {
      setConversations(sessions);
      setActiveId(sessions.some((c) => c.id === storedActive) ? storedActive : sessions[0].id);
    } else {
      const legacy = loadLegacyHistory(LS_LEGACY_HISTORY_KEY);
      if (legacy && legacy.length > 0) {
        const firstUser = legacy.find((c) => c.role === "user");
        const conv: Conv = {
          id: createId(),
          title: firstUser ? autoTitle(firstUser.content) : "历史对话",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          items: legacy,
        };
        setConversations([conv]);
        setActiveId(conv.id);
        removeLocalStorage(LS_LEGACY_HISTORY_KEY);
      } else {
        setActiveId(null);
      }
    }
    setUseKnowledge(readLocalStorage(LS_USE_KNOWLEDGE_KEY) === "true");
    setRailOpen(readLocalStorage(LS_RAIL_KEY) !== "false");
    setHydrated(true);
  }, [userKey]);

  // 变更即写回（写入当前用户名下的 key）
  useEffect(() => {
    if (!hydrated || userKey == null) return;
    if (conversations.length > 0) {
      writeLocalStorage(sessionKeyOf(userKey), JSON.stringify([...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVS)));
    } else {
      removeLocalStorage(sessionKeyOf(userKey));
    }
  }, [conversations, hydrated, userKey]);
  useEffect(() => {
    if (!hydrated || userKey == null) return;
    if (activeId) writeLocalStorage(activeKeyOf(userKey), activeId);
    else removeLocalStorage(activeKeyOf(userKey));
  }, [activeId, hydrated, userKey]);
  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(LS_RAIL_KEY, String(railOpen));
  }, [railOpen, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(LS_USE_KNOWLEDGE_KEY, String(useKnowledge));
  }, [useKnowledge, hydrated]);

  const picked = useMemo(
    () => gateways?.find((g) => g.id === pickedId) || null,
    [gateways, pickedId]
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );
  const activeConvItems = activeConv?.items ?? [];
  const sortedConvs = useMemo(
    () => {
      const query = search.trim().toLocaleLowerCase();
      return conversations
        .filter((c) => !query || [c.title, ...c.items.map((m) => m.content)]
          .some((text) => text.toLocaleLowerCase().includes(query)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [conversations, search]
  );

  // 空状态 = 当前会话还没有任何用户消息（新对话 / 清空后）
  const isWelcome = !activeConvItems.some((c) => c.role === "user");

  const convTitle = (c: Conv): string => {
    const first = c.items.find((i) => i.role === "user");
    return c.title || (first ? autoTitle(first.content) : "新对话");
  };

  // 新内容 / 流式逐字滚动到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeConvItems.length, streaming?.text]);

  // ============ 会话操作 ============
  const commitItems = useCallback(
    (convId: string, items: ChatItem[], opts?: { touch?: boolean; title?: string }) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                items: items.slice(-MAX_CHAT_ITEMS),
                title: opts?.title !== undefined ? opts.title : c.title,
                updatedAt: opts?.touch === false ? c.updatedAt : Date.now(),
              }
            : c
        )
      );
    },
    []
  );

  const abortCurrentStream = useCallback(() => {
    abortRef.current?.abort();
    finishStreamRef.current?.();
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    finishStreamRef.current?.();
  }, []);

  const deleteConv = (convId: string) => {
    modal.confirm({
      title: "删除该对话？",
      content: "删除后该对话记录将被清除且无法恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk() {
        if (streaming?.convId === convId) abortCurrentStream();
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        setActiveId((cur) => (cur === convId ? null : cur));
        appMessage.success("已删除对话");
      },
    });
  };

  const clearConv = (convId: string) => {
    modal.confirm({
      title: "清空当前对话？",
      content: "对话内容将被清空且无法恢复，清空后回到初始欢迎语。",
      okText: "清空",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk() {
        if (streaming?.convId === convId) abortCurrentStream();
        commitItems(convId, [], { title: "" });
        appMessage.success("已清空对话");
      },
    });
  };

  const selectConv = (convId: string) => {
    if (convId === activeId) return;
    abortCurrentStream(); // 切会话前中止当前流（已产出内容会留在原会话）
    setActiveId(convId);
    setMobileRailOpen(false);
  };

  const newConv = () => {
    abortCurrentStream();
    setSearch("");
    setMobileRailOpen(false);
    setActiveId(null);

  };

  const toggleFeedback = (convId: string, itemIdx: number, fb: "up" | "down") => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const items = [...c.items];
        const it = items[itemIdx];
        if (!it || it.role !== "assistant") return c;
        items[itemIdx] = { ...it, feedback: it.feedback === fb ? undefined : fb };
        return { ...c, items };
      })
    );
  };

  // ============ 发送 / 流式 ============
  const runChat = useCallback(
    async (convId: string, items: ChatItem[], refs?: { skillIds?: number[]; workflowIds?: number[]; capabilityIds?: number[]; allowToolCalls?: boolean }) => {
      const gw = picked;
      if (!gw) return;
      abortCurrentStream();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming({ convId, text: "" });
      setLiveToolRuns([]);
      const toolRuns: ToolRun[] = [];

      let finished = false;
      let raw = "";
      let finalReply: string | null = null;
      let receivedDone = false;
      // 打字机渲染队列：delta 进入 raw 缓冲，rAF 循环匀速吐字
      // 上游网关 delta 常成簇突发到达，直接显示会"一段一段跳动"；
      // 匀速吐字速度随积压量自适应（积压越多吐越快），保证平滑且能追上
      let shown = 0;
      let rafId: number | null = null;
      let lastRender = 0;
      const finishRef: { fn: ((err?: string | null, aborted?: boolean) => void) | null } = { fn: null };
      const tick = () => {
        rafId = null;
        if (finished || abortRef.current !== controller) return;
        if (shown < raw.length) {
          const backlog = raw.length - shown;
          const step = Math.max(2, Math.ceil(backlog / 12));
          shown = Math.min(raw.length, shown + step);
          // 渲染间隔下限 30ms：rAF 每帧都 setState 会让长回复全量重渲 markdown 太频繁
          const now = performance.now();
          if (now - lastRender >= 30 || shown >= raw.length) {
            lastRender = now;
            setStreaming({ convId, text: raw.slice(0, shown) });
          }
        }
        if (shown >= raw.length) {
          if (receivedDone) {
            finishRef.fn?.(null, false);
            return;
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      const ensureLoop = () => {
        if (rafId == null) rafId = requestAnimationFrame(tick);
      };
      const stopLoop = () => {
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      };
      const pushText = (t: string) => {
        raw += t;
        ensureLoop();
      };
      let meta: {
        usedDocs?: ChatItem["usedDocs"];
        drafts?: ChatDraft[];
        saveResults?: SaveResult[];
        gatewayName?: string;
        model?: string;
        gatewayId?: number;
      } = {};
      // 发送给后端的精简消息：仅保留 role/content 与引用元数据（其余 ChatItem
      // 字段如 drafts/saveResults 属于 UI 展示，不随请求发送）
      const messages = items.filter((m) => !m.error).slice(-SEND_TRIM).map((m) => ({
        role: m.role,
        content: m.content,
        usedSkills: m.usedSkills?.map((s) => ({
          id: s.id,
          name: s.name,
          displayName: s.displayName,
          description: s.description,
        })),
        usedWorkflows: m.usedWorkflows?.map((w) => ({
          id: w.id,
          name: w.name,
          displayName: w.displayName,
          description: w.description,
        })),
      }));

      // 统一收尾：追加最终 assistant 消息
      const finish = (err?: string | null, aborted?: boolean) => {
        if (finished) return;
        finished = true;
        stopLoop();
        finishRef.fn = null;
        if (abortRef.current !== controller) return;
        finishStreamRef.current = null;
        const rawContent = finalReply ?? (raw.trim() ? raw.trim() : null);
        if (rawContent || meta.drafts?.length || toolRuns.length) {
          // 仅保存可展示正文；草稿独立保留，避免仅含产物时丢失操作卡片。
          const cleaned = stripThink(stripArtifactRegion(rawContent || "")).trim();
          const emptyError = /<think>/i.test(rawContent || "")
            ? "模型仅返回了思考内容，未生成正式回答。请重试、缩短问题或切换模型。"
            : "AI 未返回有效正文，请重试或切换模型。";
          const content = cleaned || (meta.drafts?.length ? "已生成草稿，请查看下方内容。" : aborted ? "已停止生成。已完成的工具操作不会撤销。" : err || emptyError);
          const item: ChatItem = {
            role: "assistant",
            content,
            error: !aborted && !meta.drafts?.length && (!cleaned || !!err) ? true : undefined,
            usedDocs: meta.usedDocs,
            drafts: meta.drafts,
            saveResults: meta.saveResults,
            gatewayName: meta.gatewayName,
            model: meta.model,
            gatewayId: meta.gatewayId,
            toolRuns: toolRuns.map((run) => run.status === "running" ? { ...run, status: "error", output: "等待已停止；工具可能已执行，请核对结果后再重试。" } : run),
          };
          commitItems(convId, [...items, item]);
        } else if (!aborted) {
          commitItems(convId, [...items, { role: "assistant", content: `⚠️ ${err || "AI 未返回内容，请重试"}`, error: true }]);
        }
        if (err && rawContent && !aborted) {
          appMessage.warning(err);
        }
        // aborted 且无内容：用户主动停止，不追加任何消息
        setStreaming(null);
        abortRef.current = null;
      };
      finishRef.fn = finish;
      finishStreamRef.current = () => finish(null, true);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            messages,
            useKnowledge,
            gatewayId: gw.id,
            stream: true,
            skillIds: refs?.skillIds,
            workflowIds: refs?.workflowIds,
            capabilityIds: refs?.capabilityIds,
            allowToolCalls: refs?.allowToolCalls,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          throw new Error(d?.error || `HTTP ${res.status}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("无法读取流式响应");

        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (finished) return;
          buf += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(payload);
            } catch {
              continue;
            }
            if (ev.type === "delta") {
              const t = typeof ev.text === "string" ? ev.text : "";
              pushText(t);
            } else if (ev.type === "done") {
              receivedDone = true;
              finalReply = typeof ev.reply === "string" ? ev.reply : raw;
              const usedGw =
                typeof ev.gatewayId === "number"
                  ? gateways?.find((g) => g.id === ev.gatewayId)
                  : undefined;
              meta = {
                usedDocs: ev.usedDocs as ChatItem["usedDocs"] | undefined,
                drafts: ev.drafts as ChatDraft[] | undefined,
                saveResults: ev.saveResults as SaveResult[] | undefined,
                gatewayName: usedGw?.name,
                model: usedGw?.model,
                gatewayId: typeof ev.gatewayId === "number" ? ev.gatewayId : undefined,
              };
            } else if (ev.type === "tool") {
              const run = ev.run as ToolRun | undefined;
              if (run && typeof run.id === "string" && typeof run.name === "string") {
                const index = toolRuns.findIndex((r) => r.id === run.id);
                if (index < 0) toolRuns.push(run); else toolRuns[index] = run;
                setLiveToolRuns([...toolRuns]);
              }
            } else if (ev.type === "error") {
              throw new Error(typeof ev.error === "string" ? ev.error : "流式响应错误");
            }
          }
          if (done) break;
        }
        if (!receivedDone) throw new Error("连接已中断，回答可能不完整，请重试");
        // 读流结束：不立即收尾，等吐字循环追平缓冲区后再 finish，避免结尾大段跳出
        receivedDone = true;
        ensureLoop();
      } catch (err) {
        const aborted = controller.signal.aborted;
        const msg = (err as Error)?.message || String(err);
        if (aborted) {
          finish(null, true); // 用户停止 / 切会话：保留已产出内容
        } else {
          finish(msg || "网络错误，请稍后重试", false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, useKnowledge, gateways, commitItems, abortCurrentStream, appMessage]
  );

  const send = useCallback(async (extra?: SendExtra) => {
    const text = (extra?.text ?? inputRef.current).trim();
    if (!text || streaming || abortRef.current) return;
    if (!hydrated) { appMessage.warning("正在加载用户信息，请稍后再试或刷新页面"); return; }
    if (!picked) {
      appMessage.warning("暂无可用 AI 网关，请联系管理员在「管理后台 → AI 网关」中新增并启用");
      return;
    }
    if (!picked.enabled) {
      appMessage.warning("请选择已启用的 AI 网关");
      return;
    }
    const convId = activeId ?? createId();
    // 构建用户消息，包含引用信息
    const usedSkills = extra?.usedSkills ?? selectedSkills;
    const usedWorkflows = extra?.usedWorkflows ?? selectedWorkflows;
    const userItem: ChatItem = {
      role: "user",
      content: text,
      usedSkills: usedSkills.length > 0 ? usedSkills : undefined,
      usedWorkflows: usedWorkflows.length > 0 ? usedWorkflows : undefined,
      usedCapabilities: capabilities.filter((c) => capabilityIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name })),
      allowToolCalls,
    };
    const items = [...activeConvItems, userItem];

    if (activeConv) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                title: c.title || autoTitle(text),
                items: items.slice(-MAX_CHAT_ITEMS),
                updatedAt: Date.now(),
              }
            : c
        )
      );
    } else {
      setConversations((prev) =>
        [
          {
            id: convId,
            title: autoTitle(text),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items,
          },
          ...[...prev].sort((a, b) => b.updatedAt - a.updatedAt),
        ].slice(0, MAX_CONVS)
      );
    }
    setActiveId(convId);
    setInput("");
    // 清空引用
    setSelectedSkills([]);
    setSelectedWorkflows([]);

    // 传递 skillIds 和 workflowIds 给 runChat
    await runChat(convId, items, {
      skillIds: extra?.skillIds ?? selectedSkills.map((s) => s.id),
      workflowIds: extra?.workflowIds ?? selectedWorkflows.map((w) => w.id),
      capabilityIds,
      allowToolCalls,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, streaming, picked, activeId, activeConv, activeConvItems, appMessage, runChat, selectedSkills, selectedWorkflows, capabilities, capabilityIds, allowToolCalls]);

  // ============ 「/」内联命令面板：交互逻辑 ============
  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    slashOpenRef.current = false;
    slashConsumedRef.current = false;
    setSlashActiveIndex(0);
  }, []);

  const handleSlashChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setInput(value);
      if (isComposingRef.current) return; // 拼音组合中，等 compositionEnd 再判定
      const cursor = e.target.selectionStart ?? value.length;
      const { open, query } = detectSlashContext(value, cursor);
      if (open) {
        const allGroups: SlashGroup[] = [
          { key: "skill", title: GROUP_TITLES.skill, items: SlashCommandSource.buildSkillItems(skillsList) },
          { key: "workflow", title: GROUP_TITLES.workflow, items: SlashCommandSource.buildWorkflowItems(workflowsList) },
        ];
        setSlashGroups(SlashCommandSource.filterAndGroup(query, allGroups, loadRecent()));
        setSlashOpen(true);
        slashOpenRef.current = true;
        setSlashActiveIndex(0);
      } else {
        closeSlash();
      }
    },
    [skillsList, workflowsList, closeSlash]
  );

  const onSkillAction = useCallback(
    (item: SlashItem, action: "ref" | "send") => {
      if (item.payload.kind !== "skill") return;
      const src = item.payload.item;
      const ref: ItemRef = {
        id: Number(src.id),
        name: src.name,
        displayName: src.displayName || src.name,
        description: src.description,
      };
      setSelectedSkills((prev) => (prev.some((s) => s.id === ref.id) ? prev : [...prev, ref]));
      const cleaned = stripTrailingSlashToken(input);
      if (cleaned !== input) setInput(cleaned);
      closeSlash();
      pushRecent(item.token);
      if (action === "send") {
        send({ skillIds: [ref.id], usedSkills: [ref], text: cleaned });
      }
    },
    [closeSlash, send, input]
  );

  const onWorkflowAction = useCallback(
    (item: SlashItem, action: "ref" | "run") => {
      if (item.payload.kind !== "workflow") return;
      const src = item.payload.item;
      const ref: ItemRef = {
        id: Number(src.id),
        name: src.name,
        displayName: src.displayName || src.name,
        description: src.description,
      };
      setSelectedWorkflows((prev) => (prev.some((w) => w.id === ref.id) ? prev : [...prev, ref]));
      const cleaned = stripTrailingSlashToken(input);
      if (cleaned !== input) setInput(cleaned);
      closeSlash();
      pushRecent(item.token);
      if (action === "run") {
        send({ workflowIds: [ref.id], usedWorkflows: [ref], text: cleaned });
      }
    },
    [closeSlash, send, input]
  );

  const handleSlashSelect = useCallback(
    (item: SlashItem) => {
      if (item.payload.kind === "skill") {
        onSkillAction(item, "ref");
      } else if (item.payload.kind === "workflow") {
        onWorkflowAction(item, "ref");
      }
    },
    [onSkillAction, onWorkflowAction]
  );

  const handleSlashKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!slashOpenRef.current || isComposingRef.current || e.nativeEvent.isComposing) return;
      const flat = slashGroups.flatMap((g) => g.items);
      const total = flat.length;
      if (total === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeSlash();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setSlashActiveIndex((i) => (i + 1) % total);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setSlashActiveIndex((i) => (i - 1 + total) % total);
          break;
        }
        case "Enter":
        case "Tab": {
          e.preventDefault();
          slashConsumedRef.current = true;
          const item = flat[slashActiveIndex] ?? flat[0];
          if (item) handleSlashSelect(item);
          break;
        }
        case "Escape": {
          e.preventDefault();
          closeSlash();
          break;
        }
        default:
          break;
      }
    },
    [slashGroups, slashActiveIndex, closeSlash, handleSlashSelect]
  );

  /** 停止生成：保留已产出内容 */
  const stopStreaming = abortCurrentStream;

  /** 重新生成最后一条 AI 回复（回退到最后一条用户消息重新流式生成） */
  const regenerate = useCallback(() => {
    if (!activeConv || streaming || abortRef.current || !picked?.enabled) return;
    const items = activeConv.items;
    let cut = items.length;
    while (cut > 0 && items[cut - 1].role === "assistant") cut -= 1;
    if (cut === 0) return;
    const base = items.slice(0, cut);
    if (!base.some((c) => c.role === "user")) return;
    commitItems(activeConv.id, base);

    void runChat(activeConv.id, base, {
      skillIds: base[base.length - 1].usedSkills?.map((s) => s.id),
      workflowIds: base[base.length - 1].usedWorkflows?.map((w) => w.id),
      capabilityIds: base[base.length - 1].usedCapabilities?.map((c) => c.id),
      allowToolCalls: base[base.length - 1].allowToolCalls,
    });
  }, [activeConv, streaming, picked, commitItems, runChat]);

  const copyAnswer = useCallback(
    (content: string) => {
      const text = stripThink(stripArtifactRegion(content)).trim() || content;
      if (!navigator.clipboard) { appMessage.warning("复制不可用，请手动选择文本复制"); return; }
      navigator.clipboard
        ?.writeText(text)
        .then(() => appMessage.success("已复制回答"))
        .catch(() => appMessage.warning("复制失败，请手动选择文本复制"));
    },
    [appMessage]
  );

  // ============ 其它交互 ============
  async function testOne(g: Gateway) {
    setTestingId(g.id);
    try {
      const r = await fetch(`/api/ai/gateways/${g.id}/test`, {
        method: "POST",
        credentials: "include",
      });
      const d = await r.json();
      if (d.ok) appMessage.success(`「${g.name}」连接成功：${(d.reply || "").slice(0, 60)}`);
      else appMessage.error(`「${g.name}」连接失败：${d.error}`);
    } catch {
      appMessage.error("网络错误，无法发起测试");
    } finally {
      setTestingId(null);
    }
  }

  function fillTemplate(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => textAreaRef.current?.focus());
  }
  function focusComposer() {
    requestAnimationFrame(() => textAreaRef.current?.focus());
  }

  async function saveAllDrafts(itemIdx: number, drafts: ChatDraft[]) {
    let started = 0;
    for (let di = 0; di < drafts.length; di++) {
      const handle = draftHandles.current.get(`${itemIdx}-${di}`);
      if (!handle) continue;
      const ok = await handle.saveNow();
      if (ok) started++;
    }
    if (started > 0) {
      appMessage.success(`已发起 ${started}/${drafts.length} 个草稿保存`);
    } else {
      appMessage.info("没有可保存的草稿：请逐卡处理冲突或先修正编辑内容");
    }
  }

  const gatewayOptions = useMemo(() => {
    if (!gateways) return [];
    return gateways.map((g) => ({
      value: g.id,
      disabled: !g.enabled,
      label: (
        <span>
          {g.is_default ? <span style={{ color: "#faad14", marginRight: 4 }}>★</span> : null}
          {g.name} <Text type="secondary" style={{ fontSize: 12 }}>· {g.model || "未设模型"}</Text>
          {!g.enabled ? <Tag color="default" style={{ marginLeft: 6 }}>停用</Tag> : null}
        </span>
      ),
      raw: g,
    }));
  }, [gateways]);

  // —— 快捷创建：已移除输入框入口，改为发送时自动识别关键词意图（见 core/ai/commands.ts） ——

  // ============ 渲染：欢迎空状态（DeepSeek 风格居中） ============
  const renderWelcome = () => {
    const noGateway = gateways !== null && !gateways.some((g) => g.enabled);
    const cards = [
      ...QUICK_TEMPLATES.map((t) => ({
        key: t.key,
        title: `创建${t.label}草稿`,
        desc: t.desc,
        icon: TEMPLATE_ICON[t.key] ?? <ThunderboltOutlined />,
        onClick: () => fillTemplate(t.prompt),
      })),
      {
        key: "free",
        title: "提问",
        desc: "输入问题，开始新的对话",
        icon: <BulbOutlined />,
        onClick: focusComposer,
      },
    ];
    return (
      <div
        style={{
          ...colStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          paddingBlock: 24,
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <BrandAvatar size={40} radius={8} />
        </div>
        <div style={{ fontSize: 24, fontWeight: 600, color: "#1f2329", lineHeight: 1.4 }}>
          今天需要处理什么？
        </div>
        <div
          style={{
            fontSize: 14,
            color: "#8c8c8c",
            lineHeight: 1.7,
            marginTop: 8,
            maxWidth: 520,
          }}
        >
          查找知识库资料，或起草技能、工作流和文档。
        </div>

        {gateways === null ? (
          <div style={{ marginTop: 28 }}>
            <Spin />
          </div>
        ) : noGateway ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 24, textAlign: "left" }}
            message="尚未配置任何 AI 网关"
            description={
              isAdmin
                ? "请到「管理后台 → AI 网关」新增至少一个网关并启用。"
                : "请联系管理员在「管理后台 → AI 网关」中新增并启用。"
            }
          />
        ) : (
          <div
            style={{
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
              width: "100%",
              maxWidth: 560,
            }}
          >
            {cards.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={card.onClick}
                className="ai-suggest"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                  background: "#fff",
                  border: "1px solid #e5e5e7",
                  borderRadius: 14,
                  padding: "12px 14px",
                  cursor: "pointer",
                  minWidth: 0,
                  font: "inherit",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: "rgba(52, 93, 136,0.10)",
                    color: "#345d88",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {card.icon}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#1f2329",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {card.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      color: "#8c8c8c",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {card.desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div
          style={{
            marginTop: 24,
            fontSize: 12,
            color: "#bfbfbf",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <span>直接描述需求，AI 会自动识别「技能 / 工作流 / 文档」创建意图</span>
          <span>·</span>
          <span>Enter 发送，Shift + Enter 换行</span>
        </div>
      </div>
    );
  };

  // ============ 渲染：单条消息 ============
  const renderMessage = (c: ChatItem, i: number) => {
    if (c.role === "user") {
      const hasRefs = (c.usedSkills?.length ?? 0) > 0 || (c.usedWorkflows?.length ?? 0) > 0;
      return (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div
            style={{
              maxWidth: "85%",
              background: "#f4f4f5",
              color: "#1f2329",
              padding: "10px 14px",
              borderRadius: 18,
              borderTopRightRadius: 6,
              fontSize: 15,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {c.content}
          </div>
          {!!c.usedCapabilities?.length && <Space wrap size={4}>{c.usedCapabilities.map((cap) => <Tag key={cap.id} color="blue">{cap.name}</Tag>)}</Space>}
          {/* 引用标签 */}
          {hasRefs && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                justifyContent: "flex-end",
                paddingRight: 4,
              }}
            >
              {c.usedSkills?.map((s) => (
                <Tag key={s.id} style={{ background: "#ecfdf5", borderColor: "#a7f3d0", color: "#345d88", fontSize: 11 }}>
                  <CodeOutlined style={{ fontSize: 10, marginRight: 4 }} />
                  技能: {s.displayName}
                </Tag>
              ))}
              {c.usedWorkflows?.map((w) => (
                <Tag key={w.id} style={{ background: "#e6f7ff", borderColor: "#91d5ff", color: "#13c2c2", fontSize: 11 }}>
                  <PartitionOutlined style={{ fontSize: 10, marginRight: 4 }} />
                  工作流: {w.displayName}
                </Tag>
              ))}
            </div>
          )}
        </div>
      );
    }
    const isError = c.error === true;
    // 展示正文 = 剥离思考段/产物段后的内容；为空说明该条只有思考过程（历史数据或极端模型输出）
    const visible = stripThink(stripArtifactRegion(c.content)).trim();
    return (
      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <BrandAvatar size={32} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {isError ? (
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.7,
                color: "#d4380d",
                background: "#fff2e8",
                borderRadius: 10,
                padding: "10px 14px",
                border: "1px solid #ffbb96",
              }}
            >
              {c.content}
            </div>
          ) : visible ? (
            <ChatMarkdown content={visible} size={15} />
          ) : (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: "#8c8c8c",
                background: "#fafafa",
                border: "1px dashed #d9d9d9",
                borderRadius: 10,
                padding: "10px 14px",
              }}
            >
              本次回复未生成有效内容（可能仅包含模型思考过程），请点击下方 ↻ 重新生成
            </div>
          )}
          <ToolActivity runs={c.toolRuns} />
          {(!!c.usedDocs?.length || c.gatewayName) && (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "#8c8c8c",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {c.usedDocs?.map((d) => (
                <Tag
                  key={d.id}
                  color="purple"
                  style={{ marginInlineEnd: 0, fontSize: 12, lineHeight: "18px" }}
                >
                  引用：{d.title}
                </Tag>
              ))}
              {c.gatewayName && (
                <span style={{ color: "#bfbfbf" }}>
                  via {c.gatewayName} · {c.model || "—"}
                </span>
              )}
            </div>
          )}
          {!!c.drafts?.length && (
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {c.drafts.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {c.drafts.length} 个产物草稿
                  </Text>
                  <Button
                    size="small"
                    icon={<SaveOutlined />}
                    onClick={() => saveAllDrafts(i, c.drafts!)}
                  >
                    全部保存
                  </Button>
                </div>
              )}
              {c.drafts.map((draft, di) => (
                <DraftCard
                  key={draft.key || `draft-${i}-${di}`}
                  kind={draft.kind}
                  payload={draft.payload}
                  issues={draft.issues}
                  initialSaveResult={c.saveResults?.[di]}
                  handleRef={(h) => {
                    const key = `${i}-${di}`;
                    if (h) draftHandles.current.set(key, h);
                    else draftHandles.current.delete(key);
                  }}
                  onSaved={(r) =>
                    setConversations((prev) =>
                      prev.map((conv) => {
                        if (conv.id !== activeId) return conv;
                        const items = [...conv.items];
                        if (items[i]) {
                          const saveResults = items[i].saveResults
                            ? [...items[i].saveResults!]
                            : [];
                          saveResults[di] = r;
                          items[i] = { ...items[i], saveResults };
                        }
                        return { ...conv, items };
                      })
                    )
                  }
                />
              ))}
            </div>
          )}

          {isError && i === activeConvItems.length - 1 && <Button size="small" icon={<ReloadOutlined />} disabled={!!streaming} onClick={regenerate}>重试</Button>}

          {/* 回复操作行：复制 / 重新生成 / 点赞 / 点踩 */}
          {!isError && (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 2 }}>
              <ActionIconTip tip="复制" onClick={() => copyAnswer(visible || c.content)}>
                <CopyOutlined />
              </ActionIconTip>
              {i === activeConvItems.length - 1 && <ActionIconTip
                tip="重新生成"
                disabled={!!streaming}
                onClick={() => regenerate()}
              >
                <ReloadOutlined />
              </ActionIconTip>}
              <ActionIconTip
                tip={c.feedback === "up" ? "已点赞" : "有帮助"}
                active={c.feedback === "up"}
                onClick={() => activeId && toggleFeedback(activeId, i, "up")}
              >
                {c.feedback === "up" ? <LikeFilled /> : <LikeOutlined />}
              </ActionIconTip>
              <ActionIconTip
                tip={c.feedback === "down" ? "已点踩" : "没有帮助"}
                active={c.feedback === "down"}
                onClick={() => activeId && toggleFeedback(activeId, i, "down")}
              >
                {c.feedback === "down" ? <DislikeFilled /> : <DislikeOutlined />}
              </ActionIconTip>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============ 渲染：流式进行中（逐字 + 闪烁光标） ============
  const renderStreaming = () => {
    if (!streaming) return null;
    const text = stripThink(stripArtifactRegion(streaming.text)).trim();
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <BrandAvatar size={32} radius={8} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <ToolActivity runs={liveToolRuns} />
          {text ? (
            <div style={{ fontSize: 15, lineHeight: 1.7 }}>
              <ChatMarkdown content={text} size={15} />
              <span className="ai-caret" aria-hidden />
            </div>
          ) : (
            <div style={{ paddingTop: 14 }}>
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
              <span className="ai-typing-dot" />
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============ 渲染：引用 chip 行（内联，替代原「引用面板」） ============
  const renderRefChips = () => {
    const hasRefs = selectedSkills.length > 0 || selectedWorkflows.length > 0;
    if (!hasRefs) return null;
    return (
      <div className="ref-chips">
        {selectedSkills.map((s) => (
          <span className="ref-chip ref-chip-skill" key={`skill-${s.id}`}>
            <CodeOutlined className="ref-chip-icon" />
            <span className="ref-chip-label">{s.displayName}</span>
            <button
              type="button"
              className="ref-chip-remove"
              aria-label="移除引用技能"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSelectedSkills((prev) => prev.filter((x) => x.id !== s.id))}
            >
              ×
            </button>
          </span>
        ))}
        {selectedWorkflows.map((w) => (
          <span className="ref-chip ref-chip-workflow" key={`wf-${w.id}`}>
            <PartitionOutlined className="ref-chip-icon" />
            <span className="ref-chip-label">{w.displayName}</span>
            <button
              type="button"
              className="ref-chip-remove"
              aria-label="移除引用工作流"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSelectedWorkflows((prev) => prev.filter((x) => x.id !== w.id))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    );
  };

  // ============ 聊天输入区：配置 / 输入 / 操作 ============
  const renderComposer = () => {
    const canSend = hydrated && !!picked?.enabled && !streaming && input.trim().length > 0;
    const placeholder = !picked
      ? "请先选择一个可用的 AI 网关"
      : streaming ? "正在生成…" : "输入消息，或输入 / 引用技能与工作流";
    const flatItems = slashGroups.flatMap((g) => g.items);
    const activeToken = flatItems[slashActiveIndex]?.token ?? null;
    return (
      <div className={composerStyles.outer}>
        <div style={colStyle}>
          <div className={`ai-composer ${composerStyles.composer}`}>
            <SlashCommandMenu open={slashOpen} groups={slashGroups} activeToken={activeToken}
              isMobile={isMobile} enableVirtual={flatItems.length > 50} onSelect={handleSlashSelect}
              onClose={closeSlash} onSkillAction={onSkillAction} onWorkflowAction={onWorkflowAction} />
            <div className={composerStyles.configuration}>
              <div className={composerStyles.model}>
                <Select
                  aria-label="选择模型"
                  className={composerStyles.modelSelect}
                  value={pickedId ?? undefined}
                  loading={gateways === null}
                  placeholder={gateways === null ? "加载网关中…" : "选择模型"}
                  disabled={!gateways || gateways.length === 0}
                  onChange={(v) => setPickedId(v)}
                  options={gatewayOptions}
                  optionFilterProp="label"
                  popupMatchSelectWidth={isMobile ? 280 : 320}
                  suffixIcon={
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {picked && <ApiOutlined style={{ fontSize: 12, color: "#345d88" }} />}
                      <CaretDownOutlined style={{ fontSize: 10, color: "#8c8c8c" }} />
                    </span>
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <Select mode="multiple" aria-label="选择 AI 能力" placeholder="选择 Skill、MCP 或插件"
                className={composerStyles.capabilities} value={capabilityIds} onChange={setCapabilityIds}
                maxCount={10} maxTagCount="responsive" loading={capabilitiesLoading} disabled={!!streaming}
                optionFilterProp="label" options={capabilities.filter((c) => c.enabled).map((c) => ({ value: c.id, label: c.name }))} />
              <Button aria-label="能力管理" onClick={() => setCapabilitiesOpen(true)} icon={<PlusOutlined />}>能力管理</Button>
            </div>
            {capabilitiesError && <Button type="link" size="small" danger onClick={() => setCapabilitiesOpen(true)}>能力加载失败，点击重试</Button>}
            <div className={composerStyles.inputArea}>
              {renderRefChips()}
              <TextArea
                aria-label="聊天内容"
                ref={textAreaRef}
                value={input}
                onChange={handleSlashChange}
                onPressEnter={(e) => {
                  if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
                  // 面板打开时：Enter 仅确认选择，不发送（命令确认后由 closeSlash 关闭）
                  if ((slashOpenRef.current || slashConsumedRef.current) && !e.shiftKey) {
                    e.preventDefault();
                    slashConsumedRef.current = false;
                    return;
                  }
                  if (!e.shiftKey && !streaming) {
                    e.preventDefault();
                    send();
                  }
                }}
                onKeyDown={handleSlashKeyDown}
                onCompositionStart={() => {
                  isComposingRef.current = true;
                }}
                onCompositionEnd={() => {
                  isComposingRef.current = false;
                  // 组合结束（如拼音上屏）后再判定一次 slash 上下文
                  const el = textAreaRef.current?.resizableTextArea?.textArea;
                  if (el) {
                    handleSlashChange({ target: el } as ChangeEvent<HTMLTextAreaElement>);
                  }
                }}
                placeholder={placeholder}
                autoSize={{ minRows: 3, maxRows: 8 }}
                disabled={!picked}
                variant="borderless"
                style={{
                  resize: "none",
                  padding: "4px 0",
                  fontSize: 15,
                  lineHeight: 1.6,
                  background: "transparent",
                }}
              />
            </div>
            <div className={composerStyles.footer}>
              <div className={composerStyles.options}>
                <PillSwitch icon={<DatabaseOutlined />} label="参考知识库" checked={useKnowledge} onChange={setUseKnowledge} />
                <Tooltip title="允许模型调用本次选择的 MCP 工具和已引用的工作台技能，调用可能修改外部数据。">
                  <span><PillSwitch icon={<ApiOutlined />} label="允许工具调用" checked={allowToolCalls}
                    onChange={(value) => { if (!streaming) setAllowToolCalls(value); }} /></span>
                </Tooltip>
              </div>
              <div className={composerStyles.actions}>
                <Tooltip title="清空当前对话">
                  <Button
                    aria-label="清空当前对话"
                    type="text"
                    size="small"
                    icon={<ClearOutlined />}
                    disabled={!!streaming || !activeId || isWelcome}
                    onClick={() => activeId && clearConv(activeId)}
                    style={{ color: activeId && !isWelcome ? "#595959" : "#bfbfbf" }}
                  />
                </Tooltip>
                {isAdmin && (
                  <Tooltip title="网关设置">
                    <Button
                      aria-label="网关设置"
                      type="text"
                      size="small"
                      icon={<SettingOutlined />}
                      onClick={() => setSettingsOpen(true)}
                      style={{ color: "#595959" }}
                    />
                  </Tooltip>
                )}

                <Tooltip title={streaming ? "停止生成" : canSend ? "发送（Enter）" : "输入内容后发送"}>
                  <button type="button" aria-label={streaming ? "停止生成" : "发送"}
                    className={composerStyles.send} disabled={!streaming && !canSend}
                    onClick={() => streaming ? stopStreaming() : void send()}>
                    {streaming ? <span className={composerStyles.stopIcon} /> : <ArrowUpOutlined />}
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
          <div className={composerStyles.hint}>Enter 发送 · Shift + Enter 换行</div>
        </div>
      </div>
    );
  };

  // ============ 渲染：会话栏（DeepSeek 风格左侧） ============
  const renderRail = () => (
    <aside
      style={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        borderRight: "1px solid #f0f0f0",
        background: "#fcfcfd",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div style={{ padding: 14 }}>
        <Button
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={newConv}
          style={{ background: "#345d88", borderRadius: 10, height: 36 }}
        >
          开启新对话
        </Button>
      </div>
      <div
        style={{
          padding: "0 8px 4px 14px",
          fontSize: 11,
          color: "#8c8c8c",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 4,
        }}
      >
        <span>对话记录</span>
        <Tooltip title="收起对话栏">
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            onClick={() => { setRailOpen(false); setMobileRailOpen(false); }}
            style={{ color: "#8c8c8c", width: 26, height: 26 }}
          />
        </Tooltip>
      </div>
      <Input allowClear aria-label="搜索对话" placeholder="搜索标题或内容" value={search} onChange={(e) => setSearch(e.target.value)} style={{ margin: "8px", width: "calc(100% - 16px)" }} />
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 8px 12px" }}>
        {sortedConvs.length === 0 ? (
          <div style={{ padding: "18px 8px", textAlign: "center", color: "#bfbfbf", fontSize: 12 }}>
            {search ? "未找到匹配的对话" : "暂无对话"}
            <br />
            点击上方开始
          </div>
        ) : (
          sortedConvs.map((c) => {
            const isActive = c.id === activeId;
            return (
              <div
                key={c.id}
                className="ai-rail-row"
                role="button"
                tabIndex={0}
                onClick={() => selectConv(c.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === "Enter") selectConv(c.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "8px 6px 8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  background: isActive ? "rgba(52, 93, 136,0.08)" : "transparent",
                  color: isActive ? "#345d88" : "#1f2329",
                  fontWeight: isActive ? 600 : 400,
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {convTitle(c)}
                </span>
                <span
                  className="ai-rail-del"
                  style={{ opacity: 0, transition: "opacity .15s", display: "inline-flex", flexShrink: 0 }}
                >
                  <Button type="text" size="small" aria-label="重命名对话" icon={<EditOutlined />} onClick={(e) => {
                    e.stopPropagation();
                    let title = convTitle(c);
                    modal.confirm({ title: "重命名对话", content: <Input defaultValue={title} maxLength={80} aria-label="对话名称" onChange={(e) => { title = e.target.value; }} />, okText: "保存", cancelText: "取消", onOk: () => {
                      if (!title.trim()) { appMessage.warning("请输入对话名称"); return Promise.reject(new Error("empty title")); }
                      setConversations((prev) => prev.map((conv) => conv.id === c.id ? { ...conv, title: title.trim() } : conv));
                    } });
                  }} />
                  <Button type="text" size="small" aria-label="导出对话" icon={<DownloadOutlined />} onClick={(e) => {
                    e.stopPropagation();
                    const content = `# ${convTitle(c)}\n\n` + c.items.map((m) => `## ${m.role === "user" ? "我" : "AI 助手"}\n\n${stripThink(stripArtifactRegion(m.content))}`).join("\n\n");
                    const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
                    const link = document.createElement("a"); link.href = url; link.download = `${convTitle(c).replace(/[\\/:*?"<>|]/g, "_")}.md`; link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }} />
                  <Button
                    aria-label="删除对话"
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConv(c.id);
                    }}
                    style={{ color: "#bfbfbf", padding: 0, minWidth: 24, height: 24 }}
                  />
                </span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );

  // ============ 渲染：网关设置 Drawer ============
  const renderSettings = (
    <div style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="AI 网关在「管理后台 → AI 网关」中统一管理"
        description={
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Text type="secondary">
              工作台侧只读展示所有网关，方便用户了解当前可用的 AI 模型；
              新增 / 修改 / 删除 / 设为默认，请到管理后台完成。
            </Text>
            <Button
              type="primary"
              ghost
              icon={<SettingOutlined />}
              href={`${adminUrl()}/ai`}
              target="_blank"
              rel="noopener noreferrer"
            >
              前往管理后台配置 <span style={{ marginLeft: 4 }}>↗</span>
            </Button>
          </Space>
        }
      />
      {gateways === null ? (
        <Skeleton active />
      ) : gateways.length === 0 ? (
        <Empty description="尚未配置任何 AI 网关" />
      ) : (
        <Table
          rowKey="id"
          size="middle"
          tableLayout="fixed"
          pagination={false}
          dataSource={gateways}
          columns={
            [
              { title: "ID", dataIndex: "id", width: 52 },
              {
                title: "网关名称",
                dataIndex: "name",
                width: 150,
                ellipsis: true,
                render: (_, g: Gateway) => (
                  <Space size={4} style={{ display: "flex", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500 }}>{g.name}</span>
                    {g.is_default ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>默认</Tag> : null}
                  </Space>
                ),
              },
              {
                title: "服务商",
                dataIndex: "provider",
                width: 110,
                ellipsis: true,
                render: (v: string) => (
                  <Tooltip title={v}>
                    <Tag style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</Tag>
                  </Tooltip>
                ),
              },
              {
                title: "模型",
                dataIndex: "model",
                ellipsis: true,
                render: (v: string) => (
                  <Tooltip title={v}>
                    <span>{v || "—"}</span>
                  </Tooltip>
                ),
              },
              {
                title: "Base URL",
                dataIndex: "base_url",
                ellipsis: true,
                render: (v: string) => (
                  <Tooltip title={v}>
                    <span>{v || "—"}</span>
                  </Tooltip>
                ),
              },
              {
                title: "状态",
                dataIndex: "enabled",
                width: 68,
                render: (v: boolean) => (v ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
              },
              {
                title: "操作",
                key: "actions",
                width: 76,
                render: (_, g: Gateway) => (
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    loading={testingId === g.id}
                    onClick={() => testOne(g)}
                  >
                    测试
                  </Button>
                ),
              },
            ] as ColumnsType<Gateway>
          }
        />
      )}
      <Text type="secondary" style={{ display: "block", marginTop: 16, fontSize: 12 }}>
        提示：当前对话使用的模型可在底部输入框右侧的下拉框中随时切换。
      </Text>
    </div>
  );

  return (
    <div
      style={{
        // 吃掉 AppShell Content 的 padding，让 AI 区域全宽铺满
        margin: "calc(-1 * var(--content-padding, 24px))",
        height: "calc(100dvh - 60px)",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* 左侧会话栏（DeepSeek 风格；可折叠） */}
        {!isMobile && railOpen && renderRail()}

        {/* 主聊天区 */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* 会话栏收起时：左上角展示「对话记录」展开按钮 */}
          {(isMobile || !railOpen) && (
            <Tooltip title="展开对话栏">
              <button
                type="button"
                aria-label="展开对话栏"
                onClick={() => isMobile ? setMobileRailOpen(true) : setRailOpen(true)}
                style={{
                  position: "absolute",
                  left: 16,
                  top: 12,
                  zIndex: 6,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: "1px solid #e5e5e7",
                  background: "#fff",
                  color: "#595959",
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.2,
                  cursor: "pointer",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  userSelect: "none",
                  font: "inherit",
                }}
              >
                <MenuUnfoldOutlined style={{ fontSize: 13, color: "#345d88" }} />
                对话记录
              </button>
            </Tooltip>
          )}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              justifyContent: isWelcome ? "center" : "flex-start",
              paddingBlock: isWelcome ? 24 : 18,
              background: "#fff",
            }}
          >
            {isWelcome ? (
              renderWelcome()
            ) : (
              <div
                style={{
                  ...colStyle,
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                {activeConvItems.map((c, i) => renderMessage(c, i))}
                {streaming && streaming.convId === activeId && renderStreaming()}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
          {renderComposer()}
        </div>
      </div>

      {isMobile && <Drawer title="对话记录" placement="left" size={260} open={mobileRailOpen}
        onClose={() => setMobileRailOpen(false)} styles={{ body: { padding: 0, display: "flex" } }}>
        {renderRail()}
      </Drawer>}
      <CapabilitiesDrawer open={capabilitiesOpen} onClose={() => setCapabilitiesOpen(false)} capabilities={capabilities}
        loading={capabilitiesLoading} error={capabilitiesError} reload={loadCapabilities} />
      <Drawer
        title="AI 网关设置（只读）"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width={760}
        destroyOnClose={false}
      >
        {renderSettings}
      </Drawer>
    </div>
  );
}

// ============ 小组件 ============

/** Pill 开关（DeepSeek 风格的 深度思考 / 联网搜索 pill 按钮） */
function PillSwitch({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="ai-pill"
      aria-pressed={checked}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 999,
        border: `1px solid ${checked ? "#345d88" : "#e5e5e7"}`,
        background: checked ? "rgba(52, 93, 136,0.08)" : "#fff",
        color: checked ? "#345d88" : "#595959",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        lineHeight: 1.2,
        userSelect: "none",
        whiteSpace: "nowrap",
        transition: "all 0.15s",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", fontSize: 13 }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** 消息操作小按钮 */
function ActionIconTip({
  children,
  tip,
  onClick,
  disabled,
  active,
}: {
  children: ReactNode;
  tip: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip title={tip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = "rgba(0,0,0,0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        style={{
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          cursor: disabled ? "not-allowed" : "pointer",
          color: active ? "#345d88" : "#bfbfbf",
          fontSize: 13,
          transition: "color .15s, background .15s",
        }}
      >
        {children}
      </button>
    </Tooltip>
  );
}
