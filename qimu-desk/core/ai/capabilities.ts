import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { exec, row, rows } from "@/core/db";
import { parseCapability, type CapabilityConfig, type CapabilityKind, type CapabilitySummary } from "./capability-schema";

// Additive, idempotent migration for existing deployments (same policy as ensureSourceColumns).
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS ai_capabilities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  config MEDIUMTEXT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_capability_owner_kind_name (owner_id, kind, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
let ready: Promise<unknown> | undefined;
function ensureTable() {
  return ready ??= row("SELECT id FROM ai_capabilities LIMIT 0").catch(async (error) => {
    if ((error as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw error;
    await exec(TABLE_SQL);
  }).catch((error) => { ready = undefined; throw error; });
}
function encryptionKey() {
  const secret = process.env.AI_CAPABILITY_SECRET || process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("请配置至少 32 位 AI_CAPABILITY_SECRET 或 JWT_SECRET 后再添加 AI 能力");
  return createHash("sha256").update(secret).digest();
}
function seal(config: CapabilityConfig) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}
function unseal(value: string): CapabilityConfig {
  const [iv, tag, body] = value.split(".").map((s) => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
}
type RecordRow = { id: number; kind: CapabilityKind; name: string; description: string; config: string; enabled: number };
export type Capability = CapabilitySummary & { config: CapabilityConfig };
function decode(r: RecordRow): Capability {
  const config = unseal(r.config);
  return { id: r.id, kind: r.kind, name: r.name, description: r.description, enabled: !!r.enabled,
    config, skillCount: config.skills.length, serverCount: config.mcpServers.length };
}
export async function listCapabilities(ownerId: number): Promise<CapabilitySummary[]> {
  await ensureTable();
  const records = await rows<RecordRow>("SELECT id, kind, name, description, config, enabled FROM ai_capabilities WHERE owner_id = ? ORDER BY id DESC", [ownerId]);
  return records.map((r) => { const { config: _config, ...summary } = decode(r); return summary; });
}
export async function getCapability(ownerId: number, id: number): Promise<Capability | null> {
  await ensureTable();
  const record = await row<RecordRow>("SELECT id, kind, name, description, config, enabled FROM ai_capabilities WHERE id = ? AND owner_id = ?", [id, ownerId]);
  return record ? decode(record) : null;
}
export async function createCapability(ownerId: number, input: unknown) {
  const parsed = parseCapability(input);
  const encrypted = seal(parsed.config);
  await ensureTable();
  const count = await row<{ count: number }>("SELECT COUNT(*) AS count FROM ai_capabilities WHERE owner_id = ?", [ownerId]);
  if ((count?.count ?? 0) >= 50) throw new Error("最多保存 50 个 AI 能力，请先删除不再使用的条目");
  const result = await exec("INSERT INTO ai_capabilities (owner_id, kind, name, description, config) VALUES (?, ?, ?, ?, ?)",
    [ownerId, parsed.kind, parsed.name, parsed.description, encrypted]);
  return result.insertId;
}
export async function updateCapability(ownerId: number, id: number, enabled: boolean) {
  await ensureTable();
  // Verify ownership separately: MySQL can report zero changed rows for an unchanged value.
  const exists = await row("SELECT id FROM ai_capabilities WHERE id = ? AND owner_id = ?", [id, ownerId]);
  if (!exists) return false;
  await exec("UPDATE ai_capabilities SET enabled = ? WHERE id = ? AND owner_id = ?", [enabled, id, ownerId]);
  return true;
}
export async function deleteCapability(ownerId: number, id: number) {
  await ensureTable();
  return (await exec("DELETE FROM ai_capabilities WHERE id = ? AND owner_id = ?", [id, ownerId])).changes > 0;
}
