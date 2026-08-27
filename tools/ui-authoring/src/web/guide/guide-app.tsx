import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Box,
  Boxes,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Code2,
  CopyPlus,
  ExternalLink,
  Eye,
  EyeOff,
  FileDiff,
  FileJson,
  FolderOpen,
  GitBranch,
  Image as ImageIcon,
  Import as ImportIcon,
  Layers3,
  LayoutGrid,
  Link2,
  ListChecks,
  MoreHorizontal,
  MousePointer2,
  PackageOpen,
  PanelBottomOpen,
  PanelLeftClose,
  PanelRightClose,
  PanelTop,
  Pencil,
  Play,
  Redo2,
  RefreshCw,
  Rocket,
  Save,
  Search,
  SlidersHorizontal,
  Square,
  ToggleRight,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Workflow,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LegmaMark } from "../shared/legma-mark.js";
import { ThemeToggle } from "../shared/theme.js";
import styles from "./guide.module.css";

const sections = [
  {
    id: "overview",
    label: "开始",
    title: "从 Source 到画面",
    icon: Rocket,
    subsections: [
      { id: "overview-core", label: "核心概念", title: "五个名字分别回答不同问题" },
      { id: "overview-examples", label: "样例入口", title: "用现有文件建立感觉" },
      { id: "overview-flow", label: "日常路径", title: "一次完整制作" },
    ],
  },
  {
    id: "editor",
    label: "编辑器",
    title: "选择、创建与排布",
    icon: MousePointer2,
    subsections: [
      { id: "editor-anatomy", label: "界面结构", title: "每块区域只负责一类判断" },
      { id: "editor-topbar", label: "顶栏", title: "常用按钮从左到右" },
      { id: "editor-hierarchy-legend", label: "Hierarchy 图例", title: "图标、颜色和标记怎么读" },
      { id: "editor-hierarchy-actions", label: "Hierarchy 操作", title: "结构编辑集中在左侧完成" },
      { id: "editor-selection", label: "选择规则", title: "从外到内进入复杂 Widget" },
      { id: "editor-canvas", label: "Canvas", title: "Canvas 可视区域负责位置、尺寸和直接预览" },
      { id: "editor-project", label: "Project", title: "文件和资源都从 Project 进入" },
      { id: "editor-inspector", label: "Inspector", title: "右侧面板按选中对象显示对应内容" },
      { id: "editor-preview", label: "预览模式", title: "同一画面有三种读法" },
      { id: "editor-shortcuts", label: "快捷键", title: "高频操作表" },
    ],
  },
  {
    id: "states",
    label: "StateRoot",
    title: "制作和检查多状态",
    icon: ToggleRight,
    subsections: [
      { id: "states-model", label: "制作", title: "StateRoot 的三个组成部分" },
      { id: "states-boundary", label: "边界", title: "哪些变化不属于 StateRoot" },
    ],
  },
  {
    id: "inheritance",
    label: "复用与继承",
    title: "Widget、Fragment 与 Variant",
    icon: GitBranch,
    subsections: [
      { id: "inheritance-choice", label: "选择方式", title: "三种复用场景" },
      { id: "inheritance-use-site", label: "使用位置", title: "在父 Artifact 中做局部调整" },
      { id: "inheritance-variant", label: "Variant", title: "继承整个 Artifact 的稳定差量" },
    ],
  },
  {
    id: "binder",
    label: "Binder",
    title: "公开程序访问入口",
    icon: Braces,
    subsections: [
      { id: "binder-ownership", label: "归属", title: "Binder 只公开所属 Artifact 可负责的目标" },
      { id: "binder-editing", label: "人工编辑", title: "新增、本地修改与继承重定向" },
    ],
  },
  {
    id: "reference",
    label: "Reference / Prototype",
    title: "场景组合与交互演示",
    icon: Workflow,
    subsections: [
      { id: "reference-preview", label: "预览 / 编辑预览", title: "Reference 只改审阅数据" },
      { id: "reference-reference", label: "Reference", title: "不改 Artifact Source 的场景组合" },
      { id: "reference-prototype", label: "Prototype", title: "把 Reference 串成可点击流程" },
    ],
  },
  {
    id: "delivery",
    label: "交付",
    title: "保存、发布与回写",
    icon: Save,
    subsections: [
      { id: "delivery-buttons", label: "发布按钮", title: "不同按钮对应不同发布范围" },
      { id: "delivery-main", label: "发布", title: "Source 是发布行为的起点" },
      { id: "delivery-reconcile", label: "Unity 修改", title: "特殊情况下从 Prefab 回到 Source" },
      { id: "delivery-checklist", label: "完成检查", title: "离开前确认" },
    ],
  },
] as const;

type SectionId = (typeof sections)[number]["id"];
type SubsectionId = (typeof sections)[number]["subsections"][number]["id"];

function isSectionId(value: string | null): value is SectionId {
  return sections.some((section) => section.id === value);
}

function currentLocation(): { readonly sectionId: SectionId; readonly subsectionId: SubsectionId | null } {
  const sectionValue = new URLSearchParams(window.location.search).get("section");
  const sectionId = isSectionId(sectionValue) ? sectionValue : "overview";
  const section = sections.find((entry) => entry.id === sectionId)!;
  const subValue = new URLSearchParams(window.location.search).get("sub");
  const subsectionId = section.subsections.some((item) => item.id === subValue) ? (subValue as SubsectionId) : null;
  return { sectionId, subsectionId };
}

function returnLocation(): string {
  const value = new URLSearchParams(window.location.search).get("return");
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/guide")) return value;
  return "/";
}

function guideHref(section: SectionId, subsectionId?: SubsectionId): string {
  const params = new URLSearchParams(window.location.search);
  params.set("section", section);
  if (subsectionId) params.set("sub", subsectionId);
  else params.delete("sub");
  return `/guide?${params.toString()}`;
}

function artifactHref(artifactKey: string): string {
  return `/?artifact=${encodeURIComponent(artifactKey)}`;
}

export function GuideLauncher() {
  const returnUrl = `${window.location.pathname}${window.location.search}`;
  return (
    <a
      className={styles["guide-launcher"]}
      href={`/guide?return=${encodeURIComponent(returnUrl)}`}
      title="打开 Legma 使用指引"
      aria-label="打开 Legma 使用指引"
    >
      <BookOpen size={18} />
      <span>指南</span>
    </a>
  );
}

export function GuideApp() {
  const [location, setLocation] = useState(currentLocation);
  const { sectionId, subsectionId } = location;
  const sectionIndex = sections.findIndex((section) => section.id === sectionId);
  const section = sections[sectionIndex]!;
  const returnUrl = useMemo(returnLocation, []);

  useEffect(() => {
    const popstate = (): void => setLocation(currentLocation());
    window.addEventListener("popstate", popstate);
    return () => window.removeEventListener("popstate", popstate);
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      if (subsectionId) document.getElementById(subsectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
      else document.querySelector(`.${styles["guide-content"]}`)?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, [sectionId, subsectionId]);

  const navigate = (next: SectionId, nextSubsectionId?: SubsectionId): void => {
    window.history.pushState(null, "", guideHref(next, nextSubsectionId));
    setLocation({ sectionId: next, subsectionId: nextSubsectionId ?? null });
  };

  return (
    <main className={styles["guide-shell"]}>
      <header className={styles["guide-topbar"]}>
        <a className={styles["guide-brand"]} href={returnUrl} title="返回编辑器">
          <LegmaMark className={styles["guide-mark"]!} />
          <span>
            <strong>Legma Guide</strong>
            <small>Legma 使用手册</small>
          </span>
        </a>
        <div className={styles["guide-topbar-actions"]}>
          <ThemeToggle className={styles["guide-icon-button"]!} />
          <a className={styles["guide-back"]} href={returnUrl}>
            <ArrowLeft size={15} />
            返回编辑器
          </a>
        </div>
      </header>
      <aside className={styles["guide-sidebar"]}>
        <div className={styles["guide-sidebar-heading"]}>
          <BookOpen size={16} />
          <span>制作指引</span>
        </div>
        <nav aria-label="指引章节">
          {sections.map((item, index) => {
            const Icon = item.icon;
            const active = item.id === sectionId;
            return (
              <div className={styles["guide-nav-group"]} key={item.id}>
                <button className={active ? styles["is-active"] : ""} type="button" onClick={() => navigate(item.id)}>
                  <Icon size={15} />
                  <span>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    <strong>{item.label}</strong>
                  </span>
                  <ChevronRight className={`${styles["guide-nav-chevron"]} ${active ? styles["is-expanded"] : ""}`} size={14} />
                </button>
                {active ? (
                  <div className={styles["guide-subnav"]}>
                    {item.subsections.map((subsection) => (
                      <button
                        className={subsection.id === subsectionId ? styles["is-active"] : ""}
                        type="button"
                        onClick={() => navigate(item.id, subsection.id)}
                        key={subsection.id}
                        title={subsection.title}
                      >
                        {subsection.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className={styles["guide-sidebar-note"]}>
          <CircleDot size={14} />
          <p>指引描述当前编辑器能力。Source、Reference 与 Prototype 的修改会先成为未保存改动，保存后才写入文件。</p>
        </div>
      </aside>
      <nav className={styles["guide-mobile-nav"]} aria-label="指引章节">
        {sections.map((item) => (
          <button
            className={item.id === sectionId ? styles["is-active"] : ""}
            type="button"
            onClick={() => navigate(item.id)}
            key={item.id}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <article className={styles["guide-content"]}>
        <div className={styles["guide-page"]}>
          <PageHeading
            kicker={`${String(sectionIndex + 1).padStart(2, "0")} / 07`}
            title={section.title}
            summary={summaryFor(section.id)}
          />
          {section.id === "overview" ? <OverviewPage /> : null}
          {section.id === "editor" ? <EditorPage /> : null}
          {section.id === "states" ? <StateRootPage /> : null}
          {section.id === "inheritance" ? <InheritancePage /> : null}
          {section.id === "binder" ? <BinderPage /> : null}
          {section.id === "reference" ? <ReferencePage /> : null}
          {section.id === "delivery" ? <DeliveryPage /> : null}
          <footer className={styles["guide-page-footer"]}>
            <span>{section.label}</span>
            {sectionIndex < sections.length - 1 ? (
              <button type="button" onClick={() => navigate(sections[sectionIndex + 1]!.id)}>
                下一章：{sections[sectionIndex + 1]!.label}
                <ArrowRight size={15} />
              </button>
            ) : (
              <a href={returnUrl}>
                回到编辑器
                <ArrowRight size={15} />
              </a>
            )}
          </footer>
        </div>
      </article>
    </main>
  );
}

function summaryFor(section: SectionId): string {
  return {
    overview: "先确定 Artifact 的职责，再通过 Reference 组织审阅场景，最后发布到 Unity。",
    editor: "围绕 Hierarchy、Canvas 与 Inspector 完成日常结构、布局和 Component 编辑。",
    states: "在同一个 Widget 内声明状态、受控对象和状态属性，并一次检查全部结果。",
    inheritance: "复用结构时先判断归属：共享结构进 Artifact，单次差量留在使用位置，系列差异使用 Variant。",
    binder: "Binder 是 Canvas 或 Widget 对程序公开的稳定字段契约，不是 Component 的附属标签。",
    reference: "Reference 保存审阅差量与组合场景，Prototype 把多个 Reference 串成可点击流程。",
    delivery: "保存 Source、检查 Source 就绪状态并发布 Prefab；Unity 侧特殊修改通过回写进入 Source。",
  }[section];
}

function PageHeading({ kicker, title, summary }: { readonly kicker: string; readonly title: string; readonly summary: string }) {
  return (
    <header className={styles["guide-page-heading"]}>
      <span>{kicker}</span>
      <h1>{title}</h1>
      <p>{summary}</p>
    </header>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={id} className={styles["guide-section"]}>
      <header>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Figure({
  src,
  alt,
  caption,
  className = "",
}: {
  readonly src: string;
  readonly alt: string;
  readonly caption: string;
  readonly className?: string;
}) {
  return (
    <figure className={`${styles["guide-figure"]} ${className}`}>
      <img src={src} alt={alt} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function ExampleLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a className={styles["example-link"]} href={href}>
      <ExternalLink size={14} />
      {children}
    </a>
  );
}

function Steps({ items }: { readonly items: readonly { readonly title: string; readonly detail: string }[] }) {
  return (
    <ol className={styles["guide-steps"]}>
      {items.map((item, index) => (
        <li key={item.title}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  readonly tone: "info" | "warning" | "success";
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <aside className={`${styles["guide-callout"]} ${styles[`is-${tone}`]}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

function MiniControl({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return (
    <div className={styles["mini-control"]}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Marker({ className, children }: { readonly className?: string; readonly children?: ReactNode }) {
  return <span className={`${styles["marker"]} ${className ? styles[className] : ""}`}>{children}</span>;
}

function OverviewPage() {
  return (
    <>
      <div className={styles["workflow-strip"]} aria-label="UI 发布流程">
        <div>
          <FileJson size={20} />
          <span>
            <strong>Source</strong>
            <small>声明结构与行为</small>
          </span>
        </div>
        <ArrowRight size={16} />
        <div>
          <SlidersHorizontal size={20} />
          <span>
            <strong>Reference</strong>
            <small>审阅场景差量</small>
          </span>
        </div>
        <ArrowRight size={16} />
        <div>
          <Play size={20} />
          <span>
            <strong>Prototype</strong>
            <small>交互流程</small>
          </span>
        </div>
        <ArrowRight size={16} />
        <div>
          <Rocket size={20} />
          <span>
            <strong>发布</strong>
            <small>Unity Prefab</small>
          </span>
        </div>
      </div>
      <Section id="overview-core" eyebrow="核心概念" title="五个名字分别回答不同问题">
        <div className={styles["concept-matrix"]}>
          <article>
            <PanelTop size={20} />
            <h3>Canvas</h3>
            <p>完整屏幕、常驻 HUD 或弹窗入口。它拥有当前画面的 Binder，可以挂 Widget 与 Fragment。</p>
            <small>例：LaneDodgeCanvas</small>
          </article>
          <article>
            <Boxes size={20} />
            <h3>Widget</h3>
            <p>可复用且有独立程序生命周期的 UI 单元。它拥有自己的 Binder，父级只绑定实例边界。</p>
            <small>例：LaneDodgeHudWidget</small>
          </article>
          <article>
            <Layers3 size={20} />
            <h3>Fragment</h3>
            <p>只复用视觉结构和布局，不公开 Binder，不承接程序生命周期，只能依赖 Fragment。</p>
            <small>例：可复用的视觉片段</small>
          </article>
          <article>
            <SlidersHorizontal size={20} />
            <h3>Reference</h3>
            <p>审阅场景。它保存预览尺寸、Reference 数据、状态选择、列表数据和挂载的 Widget，不发布到 Unity。</p>
            <small>例：当前 Artifact 的审阅场景</small>
          </article>
          <article>
            <Play size={20} />
            <h3>Prototype</h3>
            <p>交互演示。它以 Reference 为页面，把 ButtonEx 点击串成跳转、返回或设置值流程。</p>
            <small>例：当前项目创建的 Prototype</small>
          </article>
        </div>
        <Callout tone="info" title="判断标准">
          <p>
            会进入 Prefab 和程序接口约定的是 Canvas、Widget、Fragment；只用于审阅、截图和演示的是
            Reference、Prototype。需要独立程序对象时使用 Widget；只复用视觉层级时使用 Fragment；单个使用位置的差异留在 PrefabRef 使用位置。
          </p>
        </Callout>
      </Section>
      <Section id="overview-examples" eyebrow="样例入口" title="用现有文件建立感觉">
        <div className={styles["example-grid"]}>
          <ExampleLink href={artifactHref("LaneDodgeCanvas")}>Canvas：LaneDodgeCanvas</ExampleLink>
          <ExampleLink href={artifactHref("LaneDodgeHudWidget")}>Widget：LaneDodgeHudWidget</ExampleLink>
        </div>
      </Section>
      <Section id="overview-flow" eyebrow="日常路径" title="一次完整制作">
        <Steps
          items={[
            { title: "从目录创建或打开 Artifact", detail: "结构、Component、Binding 与资源引用都写入 .ui.json。" },
            { title: "用预览检查当前改动", detail: "需要审阅数据、挂载其他 Widget 或固定状态时创建 Reference。" },
            { title: "保存并处理 Source 就绪问题", detail: "可以先保存含空必填引用的 Source，但该问题会阻止发布。" },
            { title: "发布后开发 TypeScript", detail: "发布流程始终是 .ui.json -> 发布 -> TypeScript 功能开发。" },
          ]}
        />
      </Section>
    </>
  );
}

function EditorPage() {
  const shortcuts = [
    ["V / Esc", "选择工具"],
    ["R", "绘制 Image 矩形"],
    ["T", "绘制 Text"],
    ["Ctrl/Cmd Shift N", "创建 Empty"],
    ["F2", "重命名"],
    ["Delete / Backspace", "删除"],
    ["Ctrl/Cmd C", "复制节点"],
    ["Ctrl/Cmd X", "剪切节点"],
    ["Ctrl/Cmd V", "粘贴节点"],
    ["Ctrl/Cmd D", "复制一份"],
    ["Ctrl/Cmd S", "保存"],
    ["Ctrl/Cmd Z", "撤销"],
    ["Ctrl/Cmd Shift Z", "重做"],
    ["Ctrl/Cmd Y", "重做"],
    ["Enter", "进入子级或 PrefabRef"],
    ["Shift Enter", "返回父级"],
    ["F", "定位左侧当前选择"],
    ["Arrow", "移动 1px"],
    ["Shift Arrow", "移动 10px"],
  ] as const;
  return (
    <>
      <Figure
        src="/guide/editor-overview.png"
        alt="Legma Artifact 编辑器总览"
        caption="Artifact Editor：左侧查找与组织节点，中间直接编辑画面，右侧修改所选对象。"
      />
      <Section id="editor-anatomy" eyebrow="界面结构" title="每块区域只负责一类判断">
        <div className={styles["anatomy-list"]}>
          <div>
            <strong>01 顶栏</strong>
            <p>切换预览模式、折叠面板、保存、撤销重做、打开更多工具、选择预览尺寸、查看 Prefab Diff 和发布。</p>
          </div>
          <div>
            <strong>02 左侧栏</strong>
            <p>
              Project、Hierarchy、关系三个标签页。Project 打开 Source、Reference、Prototype 和资源；Hierarchy 管理结构；关系页查看引用关系。
            </p>
          </div>
          <div>
            <strong>03 Hierarchy</strong>
            <p>处理父子关系、创建菜单、PrefabRef 展开、Binding、继承差量、错误定位和编辑可见性。</p>
          </div>
          <div>
            <strong>04 Canvas</strong>
            <p>选择、框选、绘制、拖动、缩放、吸附、对齐分布、图片拖放和文字直接编辑。</p>
          </div>
          <div>
            <strong>05 Project</strong>
            <p>可停靠在左侧或底部；筛选 Source、资源或全部，并在列表与网格视图之间切换。</p>
          </div>
          <div>
            <strong>06 Inspector</strong>
            <p>编辑选中对象的 RectTransform、Component、Reference 数据、StateRoot、使用位置差量和 Binder。</p>
          </div>
          <div>
            <strong>07 状态栏</strong>
            <p>显示保存状态、提示和当前 Source 路径；星号表示当前 Artifact 有未保存改动。</p>
          </div>
        </div>
      </Section>
      <Section id="editor-topbar" eyebrow="顶栏" title="常用按钮从左到右">
        <div className={styles["control-grid"]}>
          <MiniControl
            icon={<SlidersHorizontal size={16} />}
            title="预览 / 编辑预览 / Unity 基线"
            detail="切换求值模式。Reference 数据只在前两个模式参与画面，Unity 基线只显示 Source 字段。"
          />
          <MiniControl
            icon={<PanelLeftClose size={16} />}
            title="左侧栏"
            detail="折叠或展开 Project、Hierarchy 或关系页，给 Canvas 更多空间。"
          />
          <MiniControl
            icon={<PanelBottomOpen size={16} />}
            title="底部 Project"
            detail="把 Project 作为底部资源栏打开，适合拖图、拖 Widget 或大屏批量浏览。"
          />
          <MiniControl
            icon={<Save size={16} />}
            title="保存 / 自动保存"
            detail="保存当前文档或工作区范围的未保存改动；紧邻的自动保存开关控制自动保存，发布前也会先经过同一个保存入口。"
          />
          <MiniControl icon={<Undo2 size={16} />} title="撤销" detail="回退最近一次编辑；连续拖动、缩放或拖动数值标签会合并为一条记录。" />
          <MiniControl icon={<Redo2 size={16} />} title="重做" detail="恢复被撤销的编辑。" />
          <MiniControl
            icon={<LayoutGrid size={16} />}
            title="StateRoot 总览"
            detail="Canvas 或 Widget 存在 StateRoot 时可用；预览保留 Reference 内容，Unity 基线只显示 Source。"
          />
          <MiniControl
            icon={<MoreHorizontal size={16} />}
            title="更多工具"
            detail="查看改动、复制或粘贴节点、抽取 Widget、创建 Variant 和截图。"
          />
          <MiniControl
            icon={<PanelTop size={16} />}
            title="Canvas 预览尺寸"
            detail="Canvas 使用预设的预览尺寸；Widget 和 Fragment 显示本地尺寸。"
          />
          <MiniControl
            icon={<RefreshCw size={16} />}
            title="Prefab Diff"
            detail="按需比较当前 Projection 与 Prefab，结果显示无差异、有差异或 Prefab 缺失；打开文件时不会自动运行。"
          />
          <MiniControl
            icon={<Rocket size={16} />}
            title="发布"
            detail="主按钮发布当前文件；下拉可选择当前文件及依赖、本地改动及依赖或全部。"
          />
          <MiniControl
            icon={<ImportIcon size={16} />}
            title="回写当前文件"
            detail="读取 Prefab 并回写当前文件；更多范围位于发布下拉菜单，结果统一在回写弹窗中处理。"
          />
          <MiniControl icon={<Trash2 size={16} />} title="删除 Artifact" detail="删除当前 Source 文档；确认后会记录为未保存改动。" />
          <MiniControl icon={<PanelRightClose size={16} />} title="Inspector" detail="折叠或展开右侧属性面板。" />
        </div>
      </Section>
      <Section id="editor-hierarchy-legend" eyebrow="Hierarchy" title="图标、颜色和标记怎么读">
        <div className={styles["legend-grid"]}>
          <div>
            <Box size={14} />
            <strong>PrefabRef</strong>
            <p>引用一个独立 Widget 或 Fragment。行末的打开图标会跳到所属 Artifact。</p>
          </div>
          <div>
            <TypeIcon size={14} />
            <strong>Text</strong>
            <p>节点带 TMP Text Component；双击已选文字可直接编辑。</p>
          </div>
          <div>
            <ImageIcon size={14} />
            <strong>Image</strong>
            <p>节点带 Image Component；从 Project 拖图片到节点可替换 Sprite。</p>
          </div>
          <div>
            <Layers3 size={14} />
            <strong>Empty / Group</strong>
            <p>结构或布局节点，没有 Text 或 Image 主视觉 Component。</p>
          </div>
          <div>
            <Eye size={14} />
            <strong>编辑可见性</strong>
            <p>小眼睛只影响浏览器里的编辑视图，不修改节点的 Active，不保存，也不参与发布。</p>
          </div>
          <div>
            <EyeOff size={14} />
            <strong>未激活</strong>
            <p>节点自身的 Active 为 false 时，行透明度会降低，并显示关闭图标。</p>
          </div>
          <div>
            <Link2 size={14} />
            <strong>Binding</strong>
            <p>绿色链表示当前 Binder 字段；黄色链表示外部 Binder 或被父 Binder 引用的 Widget 边界。</p>
          </div>
          <div>
            <CircleAlert size={14} />
            <strong>Source 就绪问题</strong>
            <p>红色错误标记来自 Source 就绪校验，会阻止 Projection、回写或发布。</p>
          </div>
        </div>
        <div className={styles["status-legend"]}>
          <div>
            <Marker className="marker-info" />
            <span>蓝色/信息色行</span>
            <p>继承或引用层级，不是当前 Artifact 直接拥有的本地节点。</p>
          </div>
          <div>
            <Marker className="marker-accent" />
            <span>左侧强调线</span>
            <p>当前主选中节点；悬停时也会出现信息色左线。</p>
          </div>
          <div>
            <Marker className="marker-warning" />
            <span>黄色小点</span>
            <p>本地节点已修改；绿色小点表示新增节点。</p>
          </div>
          <div>
            <Marker className="marker-text">B</Marker>
            <span>B / BR</span>
            <p>Binder root；BR 表示 Widget root 被父 Binder 绑定为实例边界。</p>
          </div>
          <div>
            <Marker className="marker-text">SR</Marker>
            <span>SR</span>
            <p>节点带 StateRoot。</p>
          </div>
          <div>
            <Marker className="marker-text">SR:A</Marker>
            <span>SR:A</span>
            <p>节点 Active 由一个或多个 StateRoot 控制，悬停可查看控制 Root。</p>
          </div>
          <div>
            <Marker className="marker-text">OVR</Marker>
            <span>OVR</span>
            <p>Variant 或 PrefabRef 使用位置对继承字段有覆写。</p>
          </div>
          <div>
            <Marker className="marker-text">ADD</Marker>
            <span>ADD</span>
            <p>Variant 新增 Binding、使用位置新增 Component 或本地视觉子树。</p>
          </div>
          <div>
            <Marker className="marker-danger" />
            <span>红色内线</span>
            <p>当前节点存在配置不完整或 Source 就绪阻断项。</p>
          </div>
        </div>
      </Section>
      <Section id="editor-hierarchy-actions" eyebrow="Hierarchy 操作" title="结构编辑集中在左侧完成">
        <div className={styles["control-grid"]}>
          <MiniControl
            icon={<CopyPlus size={16} />}
            title="复制节点"
            detail="复制当前本地节点及子树，生成新的 Node ID；多选时复制多个本地节点。"
          />
          <MiniControl
            icon={<Pencil size={16} />}
            title="重命名"
            detail="只修改本地 Node ID；子节点 Node ID 使用 lowerCamel 风格；继承节点、根节点或多选状态下不可用。"
          />
          <MiniControl icon={<Trash2 size={16} />} title="删除" detail="删除本地节点子树；不会删除 PrefabRef 所属的 Artifact。" />
        </div>
        <Steps
          items={[
            { title: "搜索", detail: "输入 Node ID、GameObject 名称、Component 或 Binding 名称，Hierarchy 只保留命中的分支。" },
            { title: "新建", detail: "加号菜单可创建 Empty、Image、Text、PrefabRef 和模板节点；Variant 或继承层级下不可修改结构。" },
            { title: "复制、重命名、删除", detail: "按钮和快捷键都会先检查归属边界；继承节点需要打开所属 Artifact 修改结构。" },
            { title: "拖拽排序", detail: "本地节点可以拖到目标之前、内部或之后；引用层级只读，不接收结构拖拽。" },
            {
              title: "从 Project 拖入",
              detail: "拖 Widget 或 Fragment 到本地节点会创建 PrefabRef；拖图片到 Image 会替换 Sprite，拖到空白或容器会创建 Image。",
            },
          ]}
        />
      </Section>
      <Section id="editor-selection" eyebrow="选择规则" title="从外到内进入复杂 Widget">
        <Steps
          items={[
            { title: "单击", detail: "优先选择命中路径最外层的本地可编辑节点。" },
            { title: "双击或 Enter", detail: "逐层进入子节点；PrefabRef 内部会进入使用位置差量上下文。" },
            { title: "Ctrl/Cmd + 单击", detail: "直接选择命中路径最深节点。" },
            { title: "Shift + 单击", detail: "增减多选；多选 Inspector 只显示共有字段。" },
          ]}
        />
      </Section>
      <Section id="editor-canvas" eyebrow="Canvas" title="Canvas 可视区域负责位置、尺寸和直接预览">
        <div className={styles["control-grid"]}>
          <MiniControl icon={<MousePointer2 size={16} />} title="选择" detail="单击选择，拖空白框选，多选后出现对齐和分布工具。" />
          <MiniControl icon={<Square size={16} />} title="矩形工具" detail="在选中父节点内拖出 Image；拖得太小时使用默认尺寸。" />
          <MiniControl
            icon={<TypeIcon size={16} />}
            title="文本工具"
            detail="拖出 Text 后立即进入文字编辑；Enter 提交，Shift Enter 换行。"
          />
          <MiniControl
            icon={<Search size={16} />}
            title="缩放与平移"
            detail="滚轮以鼠标位置缩放；空格或中键平移 Canvas 可视区域；适配 Canvas 按钮会显示完整内容。"
          />
        </div>
        <Callout tone="info" title="拖动规则">
          <p>拖动节点时会对齐 Canvas 边缘和其它节点；按 Alt 临时关闭吸附。拖动过程中按 Escape 取消本次手势。</p>
        </Callout>
      </Section>
      <Section id="editor-project" eyebrow="Project" title="文件和资源都从 Project 进入">
        <div className={styles["capability-list"]}>
          <div>
            <FolderOpen size={17} />
            <span>
              <strong>Source</strong>
              <small>Artifact / Reference / Prototype</small>
            </span>
          </div>
          <div>
            <ImageIcon size={17} />
            <span>
              <strong>资源</strong>
              <small>Sprite、TMP Font、Animator</small>
            </span>
          </div>
          <div>
            <LayoutGrid size={17} />
            <span>
              <strong>网格</strong>
              <small>资源缩略图和大批量浏览</small>
            </span>
          </div>
          <div>
            <PanelBottomOpen size={17} />
            <span>
              <strong>停靠</strong>
              <small>左侧或底部两种停靠</small>
            </span>
          </div>
        </div>
        <p className={styles["body-copy"]}>
          Project 的筛选和视图偏好保存在浏览器本地，不写入 Source。拖拽 Project 项时，Source 文档用于创建 PrefabRef
          或跳转，图片资源用于创建或替换 Image Sprite。
        </p>
      </Section>
      <Section id="editor-inspector" eyebrow="Inspector" title="右侧面板按选中对象显示对应内容">
        <Steps
          items={[
            { title: "本地节点", detail: "在 Unity 基线中可编辑 Active、Rect Transform、Component 字段、StateRoot 和本地 Binder。" },
            {
              title: "受控 Active",
              detail: "Active 受 StateRoot 控制时先显示归属确认；可定位 Root 编辑当前状态，或明确修改 Unity 基线。",
            },
            { title: "多选节点", detail: "只显示共有且允许批量修改的字段；一次完成整组节点修改。" },
            {
              title: "PrefabRef 内部节点",
              detail: "Inspector 标明继承、覆写和新增内容；只允许修改使用位置可覆写字段和新增 Component。",
            },
            { title: "Variant", detail: "结构已锁定，只能编辑允许覆写的字段、Binding 目标覆写和本层新增 Binding。" },
            {
              title: "Component 菜单",
              detail: "Component 标题菜单可复制或粘贴 Component 值，也可删除本地 Component；继承 Component 由所属 Artifact 修改。",
            },
          ]}
        />
      </Section>
      <Section id="editor-preview" eyebrow="预览模式" title="同一画面有三种读法">
        <div className={styles["mode-grid"]}>
          <article>
            <strong>预览</strong>
            <p>只读求值同目录同名的默认 Reference；未配置时显示 Artifact 基线。</p>
          </article>
          <article>
            <strong>编辑预览</strong>
            <p>画面仍由同一个 Resolver 求值，右侧只编辑 Reference 的主体值、上下文、集合和挂载。</p>
          </article>
          <article>
            <strong>Unity 基线</strong>
            <p>只看 Source 基线。Text、Component、结构和 Binder 的修改都写入 Artifact Source。</p>
          </article>
        </div>
        <Callout tone="warning" title="不要混用">
          <p>Reference 数据不进入 Unity Projection，也不生成程序 Binding。需要发布行为时回到 Unity 基线或普通 Component 字段修改。</p>
        </Callout>
      </Section>
      <Section id="editor-shortcuts" eyebrow="快捷键" title="高频操作表">
        <div className={styles["shortcut-grid"]}>
          {shortcuts.map(([keys, action]) => (
            <div key={keys}>
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
        <Callout tone="info" title="Canvas 手势">
          <p>
            滚轮缩放以鼠标位置为中心；中键或空格平移 Canvas 可视区域。拖动节点时按 Alt 临时关闭吸附。数值标签拖动时 Shift 为 4 倍、Alt 为
            0.25 倍。
          </p>
        </Callout>
      </Section>
    </>
  );
}

function StateRootPage() {
  return (
    <>
      <Figure
        src="/guide/state-root-overview.png"
        alt="StateRoot 全部状态总览"
        caption="StateRoot 状态总览会为每个 StateRoot 分组，并同时渲染该组的全部状态。"
      />
      <Section id="states-model" eyebrow="制作" title="StateRoot 的三个组成部分">
        <div className={styles["state-model"]}>
          <div>
            <strong>状态</strong>
            <p>命名状态，并记录各目标节点在状态下是否 Active。</p>
          </div>
          <div>
            <strong>状态属性</strong>
            <p>按状态设置位置、宽高、文字、字号、颜色或透明度。</p>
          </div>
          <div>
            <strong>当前状态</strong>
            <p>Artifact 的 Source 基线。Reference 和 Prototype 只在预览层覆盖。</p>
          </div>
        </div>
        <Steps
          items={[
            { title: "在控制节点添加 StateRoot", detail: "状态控制节点可以是空节点，不要求承载视觉 Component。" },
            { title: "建立状态名称", detail: "先定义稳定、可读的状态名，再设置每个状态的 Active 目标。" },
            { title: "添加状态属性", detail: "选择目标节点和属性类型，为每个状态填写值。" },
            {
              title: "打开状态总览",
              detail: "Canvas 或 Widget 顶部工具栏逐个展开全部 StateRoot；预览保留 Reference 动态内容，Unity 基线只显示 Source。",
            },
            {
              title: "覆盖上游状态",
              detail: "需要固定嵌套 StateRoot 的预览条件时，在默认 Reference 中声明上游 StateRoot 及其状态。",
            },
          ]}
        />
        <ExampleLink href={artifactHref("LaneDodgeHudWidget")}>打开当前 Widget</ExampleLink>
      </Section>
      <Section id="states-boundary" eyebrow="边界" title="哪些变化不属于 StateRoot">
        <Callout tone="warning" title="状态不是结构变体">
          <p>
            StateRoot 不创建、删除或移动节点，也不更换 Component 集合。需要结构差异时拆分 Widget、使用 Variant，或在 Reference 中挂载独立
            Widget。
          </p>
        </Callout>
      </Section>
    </>
  );
}

function InheritancePage() {
  return (
    <>
      <Figure
        src="/guide/inheritance-use-site.png"
        alt="继承 Widget 中的 PrefabRef 使用位置编辑"
        caption="PrefabRef 展开后可直接选择继承节点；Inspector 会标明继承、覆写和新增内容。"
      />
      <Section id="inheritance-choice" eyebrow="选择方式" title="三种复用场景">
        <div className={styles["decision-table"]}>
          <div>
            <strong>多个地方完全共享</strong>
            <span>独立 Widget / Fragment</span>
          </div>
          <div>
            <strong>单个使用位置有少量差异</strong>
            <span>PrefabRef 使用位置</span>
          </div>
          <div>
            <strong>同一产品有稳定系列差异</strong>
            <span>Artifact Variant</span>
          </div>
        </div>
      </Section>
      <Section id="inheritance-use-site" eyebrow="使用位置" title="在父 Artifact 中做局部调整">
        <Steps
          items={[
            { title: "展开 PrefabRef", detail: "在 Hierarchy 或 Canvas 中进入引用内部节点。" },
            { title: "修改允许覆写的字段", detail: "Active、RectTransform 及 Registry 允许覆写的字段会写入 PrefabRef 实例差量。" },
            { title: "添加本地视觉或布局 Component", detail: "支持新增白名单 Component；实例根还可持有本地布局 Component。" },
            { title: "添加本地视觉子节点", detail: "本地子树可使用 Empty、Text 和视觉或布局 Component，不进入源 Widget。" },
          ]}
        />
        <ExampleLink href={artifactHref("LaneDodgeCanvas")}>打开当前 Canvas</ExampleLink>
        <Callout tone="warning" title="使用位置限制">
          <p>
            继承节点不能重命名、移动、删除或改变子结构；不能删除继承 Component；不能新增 PrefabRef 或 Binding；同一节点只能有一个 Graphic。
          </p>
        </Callout>
      </Section>
      <Section id="inheritance-variant" eyebrow="Variant" title="继承整个 Artifact 的稳定差量">
        <div className={styles["inheritance-chain"]}>
          <span>基础 Artifact</span>
          <ArrowRight size={16} />
          <span>Variant A</span>
          <ArrowRight size={16} />
          <span>Variant B</span>
        </div>
        <p className={styles["body-copy"]}>
          在 Artifact 菜单中选择“创建 Variant”。Variant 保留基础 Artifact 的结构，只保存属性覆写、Binding 目标覆写和新增 Binding；Canvas
          中的结构操作不可用。
        </p>
        <ExampleLink href={artifactHref("IdentifyIconNormal")}>打开 Variant 示例</ExampleLink>
        <Callout tone="warning" title="Variant 限制">
          <p>
            不能修改 Node ID、父子关系、顺序和继承 Component 集合。只有 Registry 允许覆写的字段可形成属性差量；Fragment Variant 仍然没有
            Binder。
          </p>
        </Callout>
      </Section>
    </>
  );
}

function BinderPage() {
  return (
    <>
      <div className={styles["binder-diagram"]}>
        <div>
          <span>Canvas Binder</span>
          <strong>itemCard</strong>
        </div>
        <Link2 size={20} />
        <div>
          <span>Widget 边界</span>
          <strong>ItemCardWidget</strong>
        </div>
        <div className={styles["binder-stop"]}>停止</div>
        <div>
          <span>Widget Binder</span>
          <strong>titleText</strong>
        </div>
      </div>
      <Section id="binder-ownership" eyebrow="归属" title="Binder 只公开所属 Artifact 可负责的目标">
        <p className={styles["body-copy"]}>
          Canvas 与 Widget 是 Binder 的所属对象。父 Binder 可以绑定本地节点、PrefabRef 实例本身，也可以穿过没有 Binder 的
          Fragment；遇到直接子 Widget 时停止，只能绑定该 Widget 实例，不能穿透其内部 Component。
        </p>
        <div className={styles["rule-list"]}>
          <div>
            <Check size={15} />
            <span>Canvas 到本地 Text</span>
          </div>
          <div>
            <Check size={15} />
            <span>Canvas 到 Fragment 内 Image</span>
          </div>
          <div>
            <Check size={15} />
            <span>Canvas 到子 Widget PrefabRef</span>
          </div>
          <div className={styles["is-blocked"]}>
            <span>×</span>
            <span>Canvas 到子 Widget 内 Text</span>
          </div>
        </div>
      </Section>
      <Section id="binder-editing" eyebrow="人工编辑" title="新增、本地修改与继承重定向">
        <Steps
          items={[
            { title: "选中 Binder 根节点", detail: "Canvas 或 Widget 根节点的 Inspector 显示紧凑的 Binding 字段表与投放区。" },
            {
              title: "新增 Binding",
              detail: "从 Hierarchy 将节点拖入投放区即可按 Unity Component 优先级自动创建；节点右键“添加 Binding”使用同一规则。",
            },
            { title: "编辑本地字段", detail: "本地新增的 Binding 可改名、定位和删除。字段名必须是合法的 TypeScript 标识符。" },
            {
              title: "重定向继承字段",
              detail: "Variant 中字段名保持继承，只能把目标改到相同 Component 类型的合法候选；可一键恢复基础 Artifact 的目标。",
            },
          ]}
        />
        <ExampleLink href={artifactHref("IdentifyIconNormal")}>查看 Variant 新增与覆写的 Binder 字段</ExampleLink>
        <Callout tone="info" title="字段名属于程序接口约定">
          <p>继承字段不能改名或删除。需要改变公共字段名时修改定义该字段的基础 Artifact，并同步检查所有程序调用方。</p>
        </Callout>
      </Section>
    </>
  );
}

function ReferencePage() {
  return (
    <>
      <Figure
        src="/guide/reference-prototype.png"
        alt="Reference 编辑器和 Prototype 流程"
        caption="Reference 负责单个审阅场景；Prototype 选择 ButtonEx 并为点击操作编排行为。"
      />
      <Section id="reference-preview" eyebrow="预览 / 编辑预览" title="Reference 只改审阅数据">
        <div className={styles["mode-grid"]}>
          <article>
            <strong>预览</strong>
            <p>用 Reference 的主体值、上下文、集合和挂载渲染完整场景。</p>
          </article>
          <article>
            <strong>编辑预览</strong>
            <p>双击已绑定的 Text 或 StateRoot 可写入主体值；右侧 Inspector 编辑完整的 Reference 数据。</p>
          </article>
          <article>
            <strong>Unity 基线</strong>
            <p>不应用 Reference 数据，用来核对主体 Artifact 的 Source 基线。</p>
          </article>
        </div>
        <Callout tone="info" title="写入位置">
          <p>编辑预览只写 `.ui-reference.json`；Unity 基线只写 `.ui.json`。Reference 数据不进入 Prefab 或程序 Binder。</p>
        </Callout>
      </Section>
      <Section id="reference-reference" eyebrow="Reference" title="不改 Artifact Source 的场景组合">
        <div className={styles["capability-list"]}>
          <div>
            <SlidersHorizontal size={17} />
            <span>
              <strong>主体值</strong>
              <small>按 Binder 能力覆盖</small>
            </span>
          </div>
          <div>
            <ToggleRight size={17} />
            <span>
              <strong>上下文</strong>
              <small>在父 Artifact 中定位主体</small>
            </span>
          </div>
          <div>
            <ListChecks size={17} />
            <span>
              <strong>集合</strong>
              <small>组织模板、预设和实例值</small>
            </span>
          </div>
          <div>
            <Boxes size={17} />
            <span>
              <strong>挂载的 Widget</strong>
              <small>在 Binder 目标挂载独立 Widget</small>
            </span>
          </div>
        </div>
        <p className={styles["body-copy"]}>
          每个挂载可编辑所属 Artifact、目标 Binding、Widget、预设、值、偏移和尺寸。它们只用于 Web、目录预览、Prototype 与截图，不进入 Prefab
          或 Binder。
        </p>
        <p className={styles["body-copy"]}>创建 Reference 后，可从当前目录直接打开并审阅挂载结果。</p>
      </Section>
      <Section id="reference-prototype" eyebrow="Prototype" title="把 Reference 串成可点击流程">
        <Steps
          items={[
            { title: "选择启动 Reference", detail: "Prototype 左栏可随时修改启动 Reference。" },
            { title: "选择 ButtonEx", detail: "Canvas 中的 ButtonEx 是点击触发器的合法目标。" },
            { title: "添加操作", detail: "支持跳转、返回与设置值，并可调整执行顺序。" },
            { title: "开始演示", detail: "进入隐藏编辑器界面的沉浸预览，验证返回栈和状态切换。" },
          ]}
        />
        <p className={styles["body-copy"]}>创建 Prototype 后，可从当前目录打开并演示交互流程。</p>
        <Callout tone="warning" title="职责边界">
          <p>
            Reference 和 Prototype 仅供制作，不参与 Unity Projection。需要发布的结构、Component 与 Binding 必须回到 Artifact Source 修改。
          </p>
        </Callout>
      </Section>
    </>
  );
}

function DeliveryPage() {
  return (
    <>
      <div className={styles["delivery-track"]}>
        <div>
          <Search size={18} />
          <strong>Source 就绪</strong>
          <span>必填引用、Source 索引、资源</span>
        </div>
        <div>
          <Save size={18} />
          <strong>保存</strong>
          <span>按文档写入 Source</span>
        </div>
        <div>
          <Rocket size={18} />
          <strong>发布</strong>
          <span>Prefab + Binding</span>
        </div>
        <div>
          <RefreshCw size={18} />
          <strong>回写</strong>
          <span>应用为未保存的 Source 改动</span>
        </div>
      </div>
      <Section id="delivery-buttons" eyebrow="发布按钮" title="不同按钮对应不同发布范围">
        <div className={styles["control-grid"]}>
          <MiniControl
            icon={<Rocket size={16} />}
            title="发布"
            detail="顶栏主按钮。只发布当前文件；依赖必须已经有 Node ID 映射和 Prefab。"
          />
          <MiniControl icon={<Rocket size={16} />} title="发布当前文件" detail="下拉菜单中的同范围操作，适合重新执行当前 Artifact 发布。" />
          <MiniControl
            icon={<Layers3 size={16} />}
            title="发布当前文件及依赖"
            detail="包含传递依赖闭包。依赖存在阻断项时优先使用它，不手工猜发布顺序。"
          />
          <MiniControl
            icon={<FileDiff size={16} />}
            title="发布改动及依赖"
            detail="发布 SVN 工作区中新增或修改的 UI Source 及其传递依赖；删除项不进入发布目标。"
          />
          <MiniControl
            icon={<PackageOpen size={16} />}
            title="发布全部"
            detail="在一次发布流程中按依赖顺序处理已有 DeliveryState 的 Artifact，适合已交付 UI 的全量收敛与复检。"
          />
          <MiniControl
            icon={<ImportIcon size={16} />}
            title="回写当前文件"
            detail="读取当前 Prefab，在回写弹窗中检查 patch，再应用为未保存改动。"
          />
          <MiniControl
            icon={<Layers3 size={16} />}
            title="回写当前文件及依赖"
            detail="在一次 Prefab 观测中读取当前 Artifact 和传递依赖，并按 Artifact 分组审阅。"
          />
          <MiniControl
            icon={<PackageOpen size={16} />}
            title="回写全部"
            detail="检查完整 Source 工作区并读取已有正式 Prefab；未首次发布的草稿不进入回写结果。"
          />
          <MiniControl
            icon={<XCircle size={16} />}
            title="确认并发布"
            detail="发布弹窗里的确认按钮，只解除未纳管文件、所属代码已有改动等明确列出的确认项。"
          />
          <MiniControl
            icon={<Code2 size={16} />}
            title="补齐程序接入并发布"
            detail="按程序接入清单创建最小所属类型和注册结构；业务刷新、事件和生命周期仍由程序开发补齐。"
          />
          <MiniControl
            icon={<RefreshCw size={16} />}
            title="重试"
            detail="发布失败后复用上一次范围重新执行。先查看错误或阻断项，再判断是否需要修改 Source、依赖或工作区状态。"
          />
        </div>
        <Callout tone="warning" title="确认项的边界">
          <p>
            确认项不会跳过 Source 就绪校验、Source 索引、Prefab 检查、Binding 或程序接入检查。Prefab Stage、ID 歧义、未知
            Component、业务归属不明确时必须先解决阻断项。
          </p>
        </Callout>
      </Section>
      <Section id="delivery-main" eyebrow="发布" title="Source 是发布行为的起点">
        <Steps
          items={[
            { title: "保存文档", detail: "编辑器与改动面板按当前文档保存；跨文档修改会自动包含受影响文档。" },
            { title: "修复 Source 就绪问题", detail: "Hierarchy 与 Inspector 的错误状态会定位空必填引用等阻断项。" },
            {
              title: "执行发布",
              detail: "工具先检查 Source、依赖关系、资源、归属和工作区改动，再在一次 Unity 发布流程中写入 Prefab 并完成写入后检查。",
            },
            {
              title: "读取结果",
              detail: "结果显示“已发布”才表示发布完成；“无需发布”表示 Source 与 Prefab 已一致；被阻断或失败时需要先处理问题。",
            },
            { title: "开发 TypeScript", detail: "使用生成的 Binding 和所属类型入口，不在程序侧复制 Source 结构。" },
          ]}
        />
      </Section>
      <Section id="delivery-reconcile" eyebrow="Unity 修改" title="特殊情况下从 Prefab 回到 Source">
        <p className={styles["body-copy"]}>
          直接修改 Prefab 只用于人工主动编辑、快速验证或 Source 暂时无法表达的情况。完成验证后执行“回写当前文件”，检查 Prefab 观测生成的
          patch，确认后应用为未保存改动，再保存并重新发布。
        </p>
        <Callout tone="warning" title="应用不等于保存">
          <p>应用 patch 只会更新浏览器中的未保存改动。必须显式保存 Source 并再次发布，Source 与 Prefab 才会重新一致。</p>
        </Callout>
      </Section>
      <Section id="delivery-checklist" eyebrow="完成检查" title="离开前确认">
        <div className={styles["completion-list"]}>
          {[
            "没有未保存的 Source、Reference 或 Prototype 改动",
            "所有 Source 就绪问题已处理",
            "发布结果为已发布或无需发布",
            "程序接入检查没有阻断项",
            "特殊 Prefab 修改已回写并再次发布",
          ].map((item) => (
            <div key={item}>
              <Check size={15} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
