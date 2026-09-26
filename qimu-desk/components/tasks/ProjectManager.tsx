"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Progress, Segmented, Select, Space, Spin, Table, Tag, message } from "antd";
import { AppstoreOutlined, ArrowRightOutlined, CheckOutlined, DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined, SearchOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { type ProjectRow, type TaskRow, PROJECT_COLORS, STATUS_META, PRIORITY_META } from "./types";
import { canEditRow, defaultVisibility, type VisibilityUser } from "@/core/visibility";
import VisibilityTag from "@/components/VisibilityTag";
import styles from "./ProjectManager.module.css";

function progress(p: ProjectRow) {
  return p.task_count ? Math.round(Number(p.done_count) / Number(p.task_count) * 100) : 0;
}
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("zh-CN");
}

type ProjectForm = { name: string; description?: string; color: string; visibility: "personal" | "public" };

export default function ProjectManager({ projects, user }: { projects: ProjectRow[]; user: VisibilityUser }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const locked = busy || refreshing;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("updated");
  const [view, setView] = useState("cards");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = projects.find(p => p.id === selectedId);
  const [form] = Form.useForm<ProjectForm>();
  const color = Form.useWatch("color", form);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [reload, setReload] = useState(0);
  const [taskTitle, setTaskTitle] = useState("");
  const [notice, noticeContext] = message.useMessage();

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setTasks([]);
    setTaskTitle("");
    setTasksLoading(true);
    setTasksError("");
    fetch(`/api/tasks?projectId=${selectedId}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "任务加载失败");
        if (!Array.isArray(data.tasks)) throw new Error("任务数据格式异常，请重试");
        setTasks(data.tasks.filter((task: TaskRow) => Number(task.project_id) === selectedId));
      })
      .catch(error => { if (!controller.signal.aborted) setTasksError(error.message || "任务加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setTasksLoading(false); });
    return () => controller.abort();
  }, [selectedId, reload]);

  async function mutate(url: string, method: string, body?: object) {
    setBusy(true);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false || data.error) throw new Error(data.error || "操作失败，请重试");
      startTransition(() => router.refresh());
      return true;
    } catch (error) {
      notice.error(error instanceof Error ? error.message : "网络错误，请重试");
      return false;
    } finally { setBusy(false); }
  }

  function openForm(project?: ProjectRow) {
    setEditing(project || null);
    form.resetFields();
    form.setFieldsValue({ name: project?.name || "", description: project?.description || "", color: project?.color || PROJECT_COLORS[0], visibility: project?.visibility === "personal" ? "personal" : project ? "public" : defaultVisibility(user) });
    setFormOpen(true);
  }

  async function save(values: ProjectForm) {
    if (await mutate(editing ? `/api/projects/${editing.id}` : "/api/projects", editing ? "PATCH" : "POST", { ...values, name: values.name.trim(), description: values.description?.trim() || null })) {
      setFormOpen(false);
      if (!editing) { setStatus("active"); setQuery(""); }
      notice.success(editing ? "项目已更新" : "项目已创建");
    }
  }
  async function archive(project: ProjectRow) {
    const restoring = project.status === "archived";
    if (await mutate(`/api/projects/${project.id}`, "PATCH", { status: restoring ? "active" : "archived" })) notice.success(restoring ? "项目已恢复" : "项目已归档");
  }
  async function remove(project: ProjectRow) {
    if (await mutate(`/api/projects/${project.id}`, "DELETE")) {
      if (selectedId === project.id) setSelectedId(null);
      notice.success("项目已删除，关联任务已保留");
    }
  }
  async function createTask() {
    if (!selected || !taskTitle.trim() || locked || tasksLoading) return;
    if (await mutate("/api/tasks", "POST", { title: taskTitle.trim(), projectId: selected.id, status: "todo", priority: "normal", visibility: selected.visibility || defaultVisibility(user) })) {
      setTaskTitle("");
      setReload(value => value + 1);
      notice.success("任务已添加");
    }
  }

  const active = projects.filter(p => p.status !== "archived");
  const openTasks = active.reduce((sum, p) => sum + Number(p.open_count || 0), 0);
  const doneTasks = active.reduce((sum, p) => sum + Number(p.done_count || 0), 0);
  const filtered = projects.filter(p => (status === "all" || (status === "archived" ? p.status === "archived" : p.status !== "archived")) && `${p.name} ${p.description || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : sort === "progress" ? progress(b) - progress(a) || b.id - a.id : sort === "open" ? Number(b.open_count) - Number(a.open_count) || b.id - a.id : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime() || b.id - a.id);

  function actions(project: ProjectRow) {
    return canEditRow(user, project) ? <Space size={2} wrap>
      <Button type="text" size="small" disabled={locked} icon={<EditOutlined />} aria-label={`编辑 ${project.name}`} onClick={() => openForm(project)}>编辑</Button>
      <Popconfirm title={project.status === "archived" ? "恢复此项目？" : "归档此项目？"} description={project.status === "archived" ? "项目将回到进行中列表。" : "任务会保留，可在已归档列表恢复项目。"} onConfirm={() => archive(project)} okText="确认" cancelText="取消" disabled={locked}>
        <Button type="text" size="small" disabled={locked}>{project.status === "archived" ? "恢复" : "归档"}</Button>
      </Popconfirm>
      <Popconfirm title={`删除「${project.name}」？`} description="关联任务会保留并取消项目关联，项目删除后无法恢复。" onConfirm={() => remove(project)} okText="删除" okButtonProps={{ danger: true }} cancelText="取消" disabled={locked}>
        <Button type="text" size="small" danger disabled={locked} icon={<DeleteOutlined />} aria-label={`删除 ${project.name}`} />
      </Popconfirm>
    </Space> : <span className={styles.muted}>只读项目</span>;
  }

  return <div className={styles.workspace}>
    {noticeContext}
    <header className={styles.header}>
      <div><h1>项目</h1><p>把相关任务放在一起，让每个计划有序推进。</p></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()} disabled={locked}>新建项目</Button>
    </header>
    <div className={styles.overview}>
      {[['进行中项目', active.length], ['待完成任务', openTasks], ['已完成任务', doneTasks], ['已归档项目', projects.length - active.length]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>
    <section className={styles.collection} aria-label="项目列表">
      <div className={styles.toolbar}>
        <Segmented aria-label="项目状态" value={status} onChange={setStatus} options={[{ label: `进行中 ${active.length}`, value: "active" }, { label: `已归档 ${projects.length - active.length}`, value: "archived" }, { label: "全部", value: "all" }]} />
        <div className={styles.filters}>
          <Input className={styles.search} prefix={<SearchOutlined />} placeholder="搜索项目名称或描述" aria-label="搜索项目" value={query} onChange={e => setQuery(e.target.value)} allowClear />
          <Select aria-label="项目排序" value={sort} onChange={setSort} className={styles.sort} options={[{ value: "updated", label: "最近更新" }, { value: "name", label: "名称排序" }, { value: "progress", label: "完成度优先" }, { value: "open", label: "待完成优先" }]} />
          <Segmented aria-label="项目视图" value={view} onChange={setView} options={[{ value: "cards", icon: <AppstoreOutlined />, label: <span className={styles.srOnly}>卡片</span> }, { value: "list", icon: <UnorderedListOutlined />, label: <span className={styles.srOnly}>列表</span> }]} />
        </div>
      </div>
      <div className={styles.resultCount}>共 {filtered.length} 个项目<span>任务统计仅包含你可见的任务</span></div>
      {filtered.length === 0 ? <div className={styles.empty}><Empty description={query ? "没有找到匹配的项目" : status === "archived" ? "暂无已归档项目" : "还没有项目，从一个计划开始"} />{query ? <Button onClick={() => setQuery("")}>清除搜索</Button> : status !== "archived" && <Button type="primary" onClick={() => openForm()}>新建项目</Button>}</div> : view === "cards" ? <div className={styles.grid}>
        {filtered.map(project => <article key={project.id} className={styles.card}>
          <button className={styles.cardMain} onClick={() => setSelectedId(project.id)} aria-label={`查看项目 ${project.name}`}>
            <div className={styles.cardHeading}><span className={styles.folder} style={{ color: project.color || PROJECT_COLORS[0] }}><FolderOutlined /></span><span className={styles.cardTitle}>{project.name}</span><ArrowRightOutlined className={styles.arrow} /></div>
            <div className={styles.tags}><VisibilityTag value={project.visibility} />{project.status === "archived" && <Tag>已归档</Tag>}</div>
            <p className={styles.description}>{project.description || "暂无描述，添加说明让项目目标更清晰。"}</p>
            <div className={styles.progressLabel}><span>{project.done_count} / {project.task_count} 项任务完成</span><strong>{progress(project)}%</strong></div>
            <Progress percent={progress(project)} showInfo={false} strokeColor={project.color || PROJECT_COLORS[0]} size="small" />
            <div className={styles.cardMeta}><span>{project.open_count} 项待完成</span><span>更新于 {date(project.updated_at)}</span></div>
          </button>
          <footer className={styles.cardFooter}>{actions(project)}</footer>
        </article>)}
      </div> : <Table<ProjectRow> rowKey="id" dataSource={filtered} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 850 }} columns={[
        { title: "项目名称", key: "name", render: (_, p) => <div><Button className={styles.nameButton} type="link" onClick={() => setSelectedId(p.id)}>{p.name}</Button><div><VisibilityTag value={p.visibility} />{p.status === "archived" && <Tag>已归档</Tag>}</div></div> },
        { title: "任务进度", key: "progress", width: 180, render: (_, p) => <div><span className={styles.muted}>{p.done_count} / {p.task_count} 完成</span><Progress percent={progress(p)} size="small" strokeColor={p.color || PROJECT_COLORS[0]} /></div> },
        { title: "待完成", dataIndex: "open_count", width: 90 },
        { title: "最近更新", key: "updated", width: 125, render: (_, p) => date(p.updated_at) },
        { title: "操作", key: "actions", width: 220, render: (_, p) => actions(p) },
      ]} />}
    </section>
    <Modal title={editing ? "编辑项目" : "新建项目"} open={formOpen} onCancel={() => !locked && setFormOpen(false)} closable={!locked} maskClosable={!locked} footer={null}>
      <Form form={form} layout="vertical" onFinish={save} requiredMark={false} disabled={locked}>
        <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请输入项目名称" }, { max: 100, message: "项目名称最多 100 个字" }]}><Input maxLength={100} placeholder="例如：产品迭代、读书计划" /></Form.Item>
        <Form.Item name="description" label="项目描述"><Input.TextArea rows={3} maxLength={500} showCount placeholder="希望达成什么目标？" /></Form.Item>
        <Form.Item name="visibility" label="可见范围"><Select options={[{ value: "personal", label: "个人 · 仅自己和管理员可见" }, { value: "public", label: "通用 · 所有成员可见，仅创建人和管理员可编辑" }]} /></Form.Item>
        <Form.Item label="项目颜色"><div className={styles.colors} role="group" aria-label="项目颜色">{PROJECT_COLORS.map(c => <button key={c} type="button" disabled={locked} aria-label={`颜色 ${c}`} aria-pressed={color === c} className={styles.swatch} style={{ background: c }} onClick={() => form.setFieldValue("color", c)}>{color === c && <CheckOutlined />}</button>)}</div></Form.Item>
        <Form.Item name="color" hidden><Input /></Form.Item>
        <div className={styles.formFooter}><Button disabled={locked} onClick={() => setFormOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={locked}>{editing ? "保存修改" : "创建项目"}</Button></div>
      </Form>
    </Modal>
    <Drawer title="项目详情" open={Boolean(selected)} onClose={() => setSelectedId(null)} size={560}>
      {selected && <div className={styles.detail}>
        <div><h2>{selected.name}</h2><VisibilityTag value={selected.visibility} /><Tag color={selected.status === "archived" ? "default" : "blue"}>{selected.status === "archived" ? "已归档" : "进行中"}</Tag></div>
        <p className={styles.detailDescription}>{selected.description || "暂无项目描述"}</p>
        <div className={styles.detailDates}><span>创建于 {date(selected.created_at)}</span><span>更新于 {date(selected.updated_at)}</span>{selected.owner_name && <span>创建人：{selected.owner_name}</span>}</div>
        <div><div className={styles.progressLabel}><span>已完成 {selected.done_count} / {selected.task_count} 项任务</span><strong>{progress(selected)}%</strong></div><Progress percent={progress(selected)} showInfo={false} strokeColor={selected.color || PROJECT_COLORS[0]} /></div>
        <div>{actions(selected)}</div>
        <div className={styles.taskHeading}><h3>关联任务</h3>{selected.status !== "archived" && <Button type="link" onClick={() => router.push(`/tasks?projectId=${selected.id}`)}>管理任务 <ArrowRightOutlined /></Button>}</div>
        {selected.status !== "archived" && canEditRow(user, selected) && <div className={styles.quickTask}><Input aria-label="新任务名称" placeholder="添加一项待办任务" maxLength={200} value={taskTitle} disabled={locked || tasksLoading} onChange={e => setTaskTitle(e.target.value)} onPressEnter={createTask} /><Button type="primary" icon={<PlusOutlined />} aria-label="添加任务" loading={locked} disabled={!taskTitle.trim() || tasksLoading} onClick={createTask} /></div>}
        {tasksLoading ? <div className={styles.empty}><Spin /></div> : tasksError ? <Alert type="error" title="任务加载失败" description={tasksError} action={<Button onClick={() => setReload(v => v + 1)}>重试</Button>} /> : tasks.length === 0 ? <Empty description="暂无可见的关联任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <ul className={styles.tasks}>{tasks.map(task => <li key={task.id}><div><strong>{task.title}</strong><span>{task.owner_name || ""}{task.due_date ? ` · 截止 ${task.due_date}` : ""}</span></div><Space size={4} wrap><Tag color={PRIORITY_META[task.priority].color}>{PRIORITY_META[task.priority].label}</Tag><Tag color={STATUS_META[task.status].color}>{STATUS_META[task.status].label}</Tag></Space></li>)}</ul>}
      </div>}
    </Drawer>
  </div>;
}
