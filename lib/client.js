// dsh-prompt-polish — 浏览器半区（client plugin bundle）。
//
// 由 dsh-client-modules 在 /plugins/dsh-prompt-polish/client.js 提供，经 vendored
// cordis Loader 的 lazy-CJS 模块表执行（window.__ModuleLoader__.load）。factory 体是
// 纯 CJS：require() 从 shell 模块表解析，与官方 ui-* 包的 tsdown 产物同形。
//
// 职责：在 composer 工具栏挂一个「优化」入口（按钮 + Ctrl+Alt+P），
// 取当前草稿 → 交给 Host 的 remote.promptPolish.polish() → 面板里预览 →
// 用户确认后才写回草稿（整体替换 setDraft / 选区替换 insertText）。
window.__ModuleLoader__.load({
  id: "dsh-prompt-polish",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const e = React.createElement;

    //#region dsh-prompt-polish: styles
    const CSS = [
      ".pp-root{display:flex;flex-direction:column;gap:8px;width:100%;max-width:var(--dsh-chat-content-width,720px);margin:0 auto;box-sizing:border-box;padding:2px calc(var(--dsh-composer-side-clearance,0px) + 16px) 0}",
      ".pp-dock{display:flex;align-items:center;justify-content:flex-end;gap:6px}",
      ".pp-trigger{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:12px;line-height:24px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
      ".pp-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".pp-trigger[disabled]{opacity:.45;cursor:default;background:transparent}",
      ".pp-mark{font-weight:700;font-size:11px;letter-spacing:-.02em;color:var(--dsw-alias-brand-primary)}",
      ".pp-kbd{font-size:10px;color:var(--dsw-alias-label-tertiary);opacity:.8}",
      ".pp-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));box-shadow:0 6px 20px rgba(0,0,0,.12)}",
      ".pp-head{display:flex;align-items:center;gap:10px}",
      ".pp-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap}",
      ".pp-levels{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));gap:2px}",
      ".pp-level{height:22px;padding:0 10px;border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".pp-level:hover{color:var(--dsw-alias-label-primary)}",
      ".pp-level[aria-pressed='true']{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.12)}",
      ".pp-close{margin-left:auto;width:22px;height:22px;border:0;border-radius:6px;background:transparent;cursor:pointer;font-size:15px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
      ".pp-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".pp-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".pp-preview{width:100%;box-sizing:border-box;min-height:96px;max-height:40vh;resize:vertical;padding:8px 10px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.55;outline:none}",
      ".pp-preview:focus{border-color:var(--dsw-alias-brand-primary)}",
      ".pp-line{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
      ".pp-chip{padding:0 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));color:var(--dsw-alias-label-secondary)}",
      ".pp-warn{font-size:11px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#c98a00)}",
      ".pp-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d)}",
      ".pp-skel{height:96px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));animation:pp-pulse 1.2s ease-in-out infinite}",
      "@keyframes pp-pulse{0%,100%{opacity:.45}50%{opacity:.9}}",
      "@media (prefers-reduced-motion:reduce){.pp-skel{animation:none}}",
      ".pp-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}",
      ".pp-btn{height:26px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));background:transparent;cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".pp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".pp-btn.primary{border-color:transparent;background:var(--dsw-alias-brand-primary,#3b6cf6);color:#fff;font-weight:600}",
      ".pp-btn.primary:hover{filter:brightness(1.06)}",
      ".pp-btn[disabled]{opacity:.5;cursor:default}",
      /* TRAE 式入口：一个纯图标按钮，不占文字宽度 */
      ".pp-wrap{position:relative;display:flex;align-items:center;justify-content:flex-end;gap:8px;width:100%;min-width:0;min-height:2px}",
      ".pp-star{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);flex:none;transition:color .12s ease,background .12s ease}",
      ".pp-star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}",
      ".pp-star[data-busy='true']{color:var(--dsw-alias-brand-primary);cursor:progress}",
      ".pp-star[disabled]{opacity:.4;cursor:default;background:transparent;color:var(--dsw-alias-label-tertiary)}",
      ".pp-star svg{width:15px;height:15px;display:block}",
      ".pp-star[data-busy='true'] svg{animation:pp-spin 1.4s linear infinite}",
      "@keyframes pp-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}",
      /* 就地回填后的细长提示条：已优化 · 撤销 · 详情 */
      ".pp-strip{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary)}",
      ".pp-strip-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44ch}",
      ".pp-link{border:0;background:transparent;padding:0 2px;font:inherit;font-size:12px;line-height:16px;color:var(--dsw-alias-brand-primary);cursor:pointer}",
      ".pp-link:hover{text-decoration:underline}",
      /* 长按菜单：档位 + 模式，平时不占地方 */
      ".pp-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:40;display:flex;flex-direction:column;gap:2px;min-width:200px;padding:6px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 8px 24px rgba(0,0,0,.18)}",
      ".pp-menu-item{display:flex;align-items:center;justify-content:space-between;gap:10px;height:26px;padding:0 8px;border:0;border-radius:6px;background:transparent;cursor:pointer;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);text-align:left}",
      ".pp-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".pp-menu-item[aria-checked='true']{color:var(--dsw-alias-brand-primary);font-weight:600}",
      ".pp-menu-side{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:400}",
      ".pp-menu-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l,rgba(127,127,127,.28))}",
      ".pp-menu-note{padding:2px 8px 4px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}",
      ".pp-read{max-height:38vh;overflow:auto;padding:8px 10px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04));color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55;white-space:pre-wrap}",
      "@media (prefers-reduced-motion:reduce){.pp-star[data-busy='true'] svg{animation:none}}",
    ].join("\n");
    const CSS_TAG_ID = "dsh-prompt-polish/client.css";
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]') === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-prompt-polish";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region dsh-prompt-polish: definitions
    /** 三档：轻度顺滑 / 中度结构化 / 重度指令化。 */
    const LEVELS = [
      { id: "smooth", label: "轻度", hint: "只修语法与表达，不动结构" },
      { id: "structure", label: "中度", hint: "补齐结构与关键约束" },
      { id: "instruction", label: "重度", hint: "重组为更明确的指令" },
    ];
    const LEVEL_STORAGE_KEY = "dsh-prompt-polish:level";
    const MODE_STORAGE_KEY = "dsh-prompt-polish:mode";
    /** 「智能」不是第四档，而是让插件按原文长相自己挑一档，用户不用选。 */
    const AUTO = "auto";
    const readLevel = () => {
      try {
        const saved = globalThis.localStorage?.getItem(LEVEL_STORAGE_KEY);
        if (saved === AUTO) return AUTO;
        return LEVELS.some((item) => item.id === saved) ? saved : AUTO;
      } catch {
        return AUTO;
      }
    };
    const saveLevel = (id) => {
      try {
        globalThis.localStorage?.setItem(LEVEL_STORAGE_KEY, id);
      } catch {
        /* 存储不可用时只在本次会话内生效 */
      }
    };
    /**
     * 自动选档：短句只顺语法，中等补结构，长而散的重组成指令。
     * 纯本地判断，不发请求，所以点下去没有额外等待。
     */
    const autoLevel = (text) => {
      const trimmed = String(text ?? "").trim();
      const lines = trimmed.split(/\n+/).filter((line) => line.trim() !== "");
      if (trimmed.length <= 42 && lines.length <= 2) return "smooth";
      if (trimmed.length <= 220 && lines.length <= 6) return "structure";
      return "instruction";
    };
    /** 提示条上只放两个字：轻度 / 中度 / 重度。 */
    const shortLevel = (id) => {
      const found = LEVELS.find((item) => item.id === id);
      return found === undefined ? "综合" : found.label;
    };
    /** 两种落地方式：直接回填（TRAE 手感）/ 先预览再确认（稳妥路径）。 */
    const readMode = () => {
      try {
        return globalThis.localStorage?.getItem(MODE_STORAGE_KEY) === "preview" ? "preview" : "instant";
      } catch {
        return "instant";
      }
    };
    const saveMode = (mode) => {
      try {
        globalThis.localStorage?.setItem(MODE_STORAGE_KEY, mode);
      } catch {
        /* 同上 */
      }
    };
    const localeOf = () => {
      const lang = (globalThis.document?.documentElement?.lang || globalThis.navigator?.language || "zh").toLowerCase();
      return lang.startsWith("zh") ? "zh" : lang.slice(0, 2);
    };

    /** 必须原样保留的 token：@引用、/命令、代码、URL、命令行参数。 */
    const TOKEN_PATTERNS = [
      /```[\s\S]*?```/g,
      /`[^`\n]+`/g,
      /https?:\/\/[^\s，。；、)）]+/g,
      /@[^\s@，。；、]+/g,
      /(?:^|[\s(（])(--?[A-Za-z][\w-]*)/g,
      /(?:^|\s)(\/[a-z][\w-]*)/g,
    ];
    const keyTokens = (text) => {
      const found = new Set();
      for (const pattern of TOKEN_PATTERNS) {
        for (const match of String(text ?? "").matchAll(pattern)) {
          const raw = (match[1] ?? match[0] ?? "").trim();
          if (raw !== "") found.add(raw);
        }
      }
      return [...found];
    };
    const missingTokens = (original, result) => keyTokens(original).filter((token) => !String(result ?? "").includes(token));

    /** 面板状态按 Session 缓存，切换会话再回来仍能看到上次结果。 */
    const panels = new Map();
    const listeners = new Set();
    const starters = new Map();
    const stripTimers = new Map();
    let activeStarter = null;
    const panelOf = (sid) => {
      let panel = panels.get(sid);
      if (panel === undefined) {
        panel = {
          open: false,
          level: readLevel(),
          mode: readMode(),
          menuOpen: false,
          busy: false,
          phase: "idle",
          result: null,
          edited: "",
          error: "",
          warning: "",
          missing: [],
          snapshot: null,
          strip: null,
          applied: false,
          seq: 0,
        };
        panels.set(sid, panel);
      }
      return panel;
    };
    const updatePanel = (sid, patch) => {
      panels.set(sid, { ...panelOf(sid), ...patch });
      for (const listener of [...listeners]) listener(sid);
    };
    const subscribePanels = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    /** 远程方法：remote.promptPolish.polish（Host 半区注册）。 */
    const remoteOf = (ctx) => {
      try {
        return ctx?.remote?.promptPolish ?? ctx?.get?.("remote.promptPolish") ?? null;
      } catch {
        return null;
      }
    };
    /**
     * Typert 一元调用返回 `{ ok, value } | { ok, error }` 信封，而不是裸结果；
     * 这里两种形态都吃：带 value/error 键就当信封拆开。
     */
    const unwrapRpc = (response) => {
      if (response === null || typeof response !== "object") return response;
      const isEnvelope = Object.prototype.hasOwnProperty.call(response, "value") || Object.prototype.hasOwnProperty.call(response, "error");
      if (!isEnvelope) return response;
      if (response.ok === true) return response.value;
      const error = response.error;
      return {
        ok: false,
        code: error?.code ?? "REQUEST_FAILED",
        message: error?.message ?? "优化失败，请重试",
      };
    };
    //#endregion

    //#region dsh-prompt-polish: controller
    /** 关掉面板，同时丢弃面板里的临时状态（提示条与「已应用」标记保留）。 */
    const closePanel = (sessionId) => {
      const panel = panelOf(sessionId);
      updatePanel(sessionId, {
        open: false,
        phase: "idle",
        result: null,
        edited: "",
        error: "",
        warning: "",
        snapshot: null,
        applied: false,
        menuOpen: false,
        seq: panel.seq + 1,
      });
    };

    /** 提示条自动淡出，避免长期占着输入框上方那一行。 */
    const armStripTimer = (sessionId, ms) => {
      const running = stripTimers.get(sessionId);
      if (running !== undefined) clearTimeout(running);
      const timer = setTimeout(() => {
        stripTimers.delete(sessionId);
        if (panelOf(sessionId).open) return;
        updatePanel(sessionId, { strip: null });
      }, ms);
      stripTimers.set(sessionId, timer);
    };

    /**
     * 一次优化请求。
     * - 直接回填（默认）：拿到结果立刻替换草稿，留一条「已优化 · 撤销」提示条；
     * - 先预览：结果只进面板，等用户确认。
     * 两种模式都在请求前抓快照，撤销/回退一律回到这份快照。
     */
    function runPolish(props, sessionId, levelOverride) {
      const input = props.input;
      const actions = props.inputActions;
      const draft = typeof input?.draft === "string" ? input.draft : "";
      const panel = panelOf(sessionId);
      const wanted = LEVELS.some((item) => item.id === levelOverride) ? levelOverride : panel.level;
      if (draft.trim() === "") {
        updatePanel(sessionId, { open: true, phase: "error", error: "输入框是空的，先写点内容再优化" });
        return;
      }
      const remote = remoteOf(props.polishCtx);
      if (remote === null || typeof remote.polish !== "function") {
        updatePanel(sessionId, { open: true, phase: "error", error: "优化服务未就绪（Host 半区没加载），请重启 DSH 后重试" });
        return;
      }
      let target = draft;
      let span = null;
      try {
        const captured = actions?.captureInsertion?.();
        if (captured && typeof captured.start === "number" && captured.end > captured.start) {
          const slice = draft.slice(captured.start, captured.end);
          if (slice.trim() !== "") {
            target = slice;
            span = captured;
          }
        }
      } catch {
        /* 选区不可用时退化为整段优化 */
      }
      // 直接回填只做整段：选区替换再撤销语义会变复杂，选区一律走预览。
      const instant = panel.mode === "instant" && span === null;
      const level = wanted === AUTO ? autoLevel(target) : wanted;
      const seq = panel.seq + 1;
      updatePanel(sessionId, {
        open: !instant,
        applied: false,
        busy: true,
        phase: instant ? "loading" : "loading",
        level,
        strip: null,
        menuOpen: false,
        error: "",
        warning: "",
        missing: [],
        result: null,
        edited: "",
        snapshot: { text: draft, target, span },
        seq,
      });
      const startedAt = Date.now();
      Promise.resolve(remote.polish({ text: target, level, locale: localeOf() })).then(
        (raw) => {
          if (panelOf(sessionId).seq !== seq) return;
          const response = unwrapRpc(raw);
          if (response === null || typeof response !== "object" || response.ok !== true) {
            updatePanel(sessionId, { busy: false, open: true, phase: "error", error: response?.message || "优化失败，请重试" });
            return;
          }
          const text = String(response.text ?? "");
          // 兜底护栏：万一把模型裸 JSON 当正文返回，也绝不写进输入框。
          if (/^\s*\{\s*"text"\s*:/.test(text)) {
            updatePanel(sessionId, {
              busy: false,
              open: true,
              phase: "error",
              error: "模型这次输出不完整，没有写回输入框，再点一次星星重试",
            });
            return;
          }
          const missing = missingTokens(target, text);
          if (instant) {
            actions?.setDraft?.(text);
            updatePanel(sessionId, {
              busy: false,
              open: false,
              phase: "idle",
              result: response,
              edited: text,
              missing,
              applied: true,
              strip: {
                before: draft,
                after: text,
                level: response.level ?? level,
                levelLabel: response.levelLabel ?? LEVELS.find((item) => item.id === level)?.label ?? "",
                elapsed: Date.now() - startedAt,
                missing,
              },
            });
            armStripTimer(sessionId, 12000);
            return;
          }
          updatePanel(sessionId, { busy: false, phase: "ready", result: response, edited: text, missing });
        },
        (error) => {
          if (panelOf(sessionId).seq !== seq) return;
          updatePanel(sessionId, {
            busy: false,
            open: true,
            phase: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
    }

    /** 撤销一次直接回填：把草稿原样换回快照文本。 */
    function undoInstant(props, sessionId) {
      const panel = panelOf(sessionId);
      const strip = panel.strip;
      if (strip === null) return;
      props.inputActions?.setDraft?.(strip.before);
      const running = stripTimers.get(sessionId);
      if (running !== undefined) clearTimeout(running);
      stripTimers.delete(sessionId);
      updatePanel(sessionId, { strip: null, applied: false, result: null, edited: "", missing: [], open: false, phase: "idle" });
    }

    /** 把提示条展开成面板：只读展示这次改了什么、补了哪些假设。 */
    function openDetails(sessionId) {
      const panel = panelOf(sessionId);
      const strip = panel.strip;
      if (strip === null || panel.result === null) return;
      const running = stripTimers.get(sessionId);
      if (running !== undefined) clearTimeout(running);
      updatePanel(sessionId, {
        open: true,
        applied: true,
        busy: false,
        phase: "ready",
        edited: strip.after,
        result: panel.result,
        missing: strip.missing,
        snapshot: { text: strip.before, target: strip.before, span: null },
      });
    }

    /** 确认插入（先预览模式）：选区走 insertText（原子可撤销），整段走 setDraft。 */
    function confirmInsert(props, sessionId, force) {
      const panel = panelOf(sessionId);
      const input = props.input;
      const actions = props.inputActions;
      const current = typeof input?.draft === "string" ? input.draft : "";
      const snapshot = panel.snapshot;
      const text = panel.edited;
      if (snapshot === null || text.trim() === "") return;
      if (snapshot.span !== null && actions?.insertText) {
        let accepted = false;
        try {
          accepted = actions.insertText(text, snapshot.span) !== false;
        } catch {
          accepted = false;
        }
        if (!accepted) {
          updatePanel(sessionId, { warning: "草稿在优化期间被改动了，插入被拒绝：请再优化一次" });
          return;
        }
      } else {
        if (!force && current !== snapshot.text) {
          updatePanel(sessionId, { phase: "overwrite" });
          return;
        }
        actions?.setDraft?.(text);
      }
      closePanel(sessionId);
    }
    //#endregion

    //#region dsh-prompt-polish: components
    /** 一颗四角星：TRAE 那种「不解释，就是一个图标」的入口。 */
    function SparkleGlyph() {
      return e(
        "svg",
        { viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
        e("path", {
          fill: "currentColor",
          d: "M12 2.6l1.62 4.9a5.4 5.4 0 0 0 3.28 3.28L21.8 12.4l-4.9 1.62a5.4 5.4 0 0 0-3.28 3.28L12 22.2l-1.62-4.9a5.4 5.4 0 0 0-3.28-3.28L2.2 12.4l4.9-1.62a5.4 5.4 0 0 0 3.28-3.28L12 2.6z",
        }),
        e("path", { fill: "currentColor", opacity: ".55", d: "M19.4 2.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z" }),
      );
    }

    function PanelBody({ panel, sessionId, props, onClose }) {
      if (panel.phase === "loading") {
        return e("div", { className: "pp-skel", "aria-label": "正在优化" });
      }
      if (panel.phase === "error") {
        return e(
          "div",
          { className: "pp-error", role: "alert" },
          panel.error,
          e(
            "div",
            { className: "pp-actions", style: { marginTop: 8 } },
            e("button", { type: "button", className: "pp-btn", onClick: onClose }, "取消"),
            e("button", { type: "button", className: "pp-btn primary", onClick: () => runPolish(props, sessionId) }, "重试"),
          ),
        );
      }
      if (panel.phase === "overwrite") {
        return e(
          "div",
          { className: "pp-panel" },
          e("div", { className: "pp-warn" }, "草稿在优化期间被改动了。仍然用优化结果替换整段吗？"),
          e(
            "div",
            { className: "pp-actions" },
            e("button", { type: "button", className: "pp-btn", onClick: () => updatePanel(sessionId, { phase: "ready" }) }, "返回预览"),
            e("button", { type: "button", className: "pp-btn primary", onClick: () => confirmInsert(props, sessionId, true) }, "仍然替换"),
          ),
        );
      }
      if (panel.phase !== "ready") return null;
      const result = panel.result ?? {};
      const applied = panel.applied === true;
      return e(
        React.Fragment,
        null,
        applied
          ? e("div", { className: "pp-read" }, panel.edited)
          : e("textarea", {
              className: "pp-preview",
              value: panel.edited,
              spellCheck: false,
              rows: 6,
              onChange: (event) => updatePanel(sessionId, { edited: event.target.value }),
              "aria-label": "优化结果预览，可直接修改",
            }),
        panel.missing.length > 0
          ? e("div", { className: "pp-warn", role: "status" }, "结果里缺少这些原样内容，请核对：" + panel.missing.join("、"))
          : null,
        Array.isArray(result.assumptions) && result.assumptions.length > 0
          ? e(
              "div",
              { className: "pp-line" },
              e("span", { className: "pp-warn" }, "补全的假设："),
              result.assumptions.map((item, index) => e("span", { key: "a" + index, className: "pp-chip" }, item)),
            )
          : null,
        Array.isArray(result.notes) && result.notes.length > 0
          ? e(
              "div",
              { className: "pp-line" },
              result.notes.map((item, index) => e("span", { key: "n" + index, className: "pp-chip" }, item)),
            )
          : null,
        panel.warning !== "" ? e("div", { className: "pp-warn", role: "alert" }, panel.warning) : null,
        e(
          "div",
          { className: "pp-actions" },
          e(
            "span",
            {
              className: "pp-hint",
              style: { marginRight: "auto" },
              "data-pp-version": result.version ? "v" + result.version : "",
            },
            (result.model ? result.model + " · " : "") + (result.levelLabel ?? "") + (result.version ? " · v" + result.version : ""),
          ),
          applied
            ? e(
                React.Fragment,
                null,
                e("button", { type: "button", className: "pp-btn", onClick: () => undoInstant(props, sessionId) }, "撤销这次优化"),
                e("button", { type: "button", className: "pp-btn primary", onClick: onClose }, "好"),
              )
            : e(
                React.Fragment,
                null,
                e("button", { type: "button", className: "pp-btn", onClick: onClose }, "取消"),
                e("button", { type: "button", className: "pp-btn primary", onClick: () => confirmInsert(props, sessionId, false) }, "确认插入"),
              ),
        ),
      );
    }

    function Dock(props) {
      const sessionId = String(props.sessionId ?? props.session?.sessionId ?? props.session?.id ?? "default");
      const input = props.input;
      const draft = typeof input?.draft === "string" ? input.draft : "";
      const [panel, setPanel] = React.useState(() => panelOf(sessionId));
      const rootRef = React.useRef(null);
      const menuRef = React.useRef(null);
      const pressRef = React.useRef({ timer: null, fired: false });
      const latest = React.useRef({ props, sessionId, panel });
      latest.current = { props, sessionId, panel };

      React.useEffect(() => {
        setPanel(panelOf(sessionId));
        return subscribePanels((changed) => {
          if (changed === sessionId) setPanel(panelOf(sessionId));
        });
      }, [sessionId]);

      // 注册本 Session 的启动器，供快捷键（Host 侧命令）调用。
      React.useEffect(() => {
        const starter = () => runPolish(latest.current.props, sessionId, undefined);
        starters.set(sessionId, starter);
        return () => {
          if (starters.get(sessionId) === starter) starters.delete(sessionId);
          if (activeStarter === starter) activeStarter = null;
        };
      }, [sessionId]);

      // composer 容器上的快捷键：Ctrl/Cmd + Alt + P（捕获阶段先于编辑器）。
      React.useEffect(() => {
        const node = rootRef.current;
        if (node === null) return;
        let host = node;
        for (let depth = 0; depth < 5; depth += 1) {
          if (host.parentElement === null) break;
          host = host.parentElement;
          const editable = host.querySelector?.('[contenteditable="true"], textarea');
          if (editable !== null && editable !== undefined) break;
        }
        const markActive = () => {
          const starter = starters.get(sessionId);
          if (starter !== undefined) activeStarter = starter;
        };
        const onKeyDown = (event) => {
          if (event.code !== "KeyP" || !event.altKey || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          event.stopPropagation();
          markActive();
          runPolish(latest.current.props, sessionId, undefined);
        };
        host.addEventListener("pointerdown", markActive, true);
        host.addEventListener("focusin", markActive, true);
        host.addEventListener("keydown", onKeyDown, true);
        return () => {
          host.removeEventListener("pointerdown", markActive, true);
          host.removeEventListener("focusin", markActive, true);
          host.removeEventListener("keydown", onKeyDown, true);
        };
      }, [sessionId]);

      React.useEffect(() => {
        if (!panel.open && !panel.menuOpen) return;
        const onKey = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (panel.menuOpen) updatePanel(sessionId, { menuOpen: false });
            else closePanel(sessionId);
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && panel.open) {
            event.preventDefault();
            confirmInsert(latest.current.props, sessionId, false);
          }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      }, [panel.open, panel.menuOpen, sessionId]);

      // 点菜单外面就收起。
      React.useEffect(() => {
        if (!panel.menuOpen) return;
        const onDown = (event) => {
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return;
          updatePanel(sessionId, { menuOpen: false });
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }, [panel.menuOpen, sessionId]);

      const pickLevel = (id) => {
        saveLevel(id);
        updatePanel(sessionId, { level: id, menuOpen: false });
        if (panel.open && panel.phase === "ready") runPolish(props, sessionId);
      };
      const pickMode = (mode) => {
        saveMode(mode);
        updatePanel(sessionId, { mode, menuOpen: false });
      };
      const openMenu = () => updatePanel(sessionId, { menuOpen: true });

      const startPress = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        const timer = setTimeout(() => {
          pressRef.current.fired = true;
          openMenu();
        }, 450);
        pressRef.current = { timer, fired: false };
      };
      const endPress = () => {
        const { timer } = pressRef.current;
        if (timer !== null) clearTimeout(timer);
        pressRef.current = { ...pressRef.current, timer: null };
      };
      const onClick = () => {
        if (pressRef.current.fired) {
          pressRef.current = { timer: null, fired: false };
          return;
        }
        if (panel.open) closePanel(sessionId);
        else runPolish(props, sessionId, undefined);
      };

      const empty = draft.trim() === "";
      const phase = input?.phase;
      const busyPhase = phase === "submitting" || phase === "adjudicating";
      const busy = busyPhase || panel.busy === true;
      const levelLabel = panel.level === AUTO ? "智能" : LEVELS.find((item) => item.id === panel.level)?.label ?? "智能";
      const modeLabel = panel.mode === "preview" ? "先预览" : "直接回填";
      const title = empty ? "先写点内容再优化" : busyPhase ? "发送中，稍后再优化" : `优化输入（${levelLabel} · ${modeLabel} · Ctrl+Alt+P）`;
      const strip = panel.open ? null : panel.strip;

      return e(
        "div",
        { className: "pp-root", ref: rootRef, "data-prompt-polish": true },
        panel.open
          ? e(
              "div",
              { className: "pp-panel", role: "dialog", "aria-label": "优化输入" },
              e(
                "div",
                { className: "pp-head" },
                e("span", { className: "pp-title" }, panel.applied ? "本次优化的改动" : "优化输入"),
                e("span", { className: "pp-hint" }, levelLabel + " · " + modeLabel),
                e("button", { type: "button", className: "pp-close", onClick: () => closePanel(sessionId), "aria-label": "关闭" }, "×"),
              ),
              e(PanelBody, { panel, sessionId, props, onClose: () => closePanel(sessionId) }),
            )
          : null,
        e(
          "div",
          { className: "pp-wrap" },
              strip !== null && strip !== undefined
            ? e(
                "div",
                { className: "pp-strip", role: "status" },
                e(
                  "span",
                  { className: "pp-strip-text" },
                  "已优化 · " + shortLevel(strip.level) + " · " + (strip.elapsed / 1000).toFixed(1) + "s",
                ),
                e("button", { type: "button", className: "pp-link", onClick: () => undoInstant(props, sessionId) }, "撤销"),
                e("button", { type: "button", className: "pp-link", onClick: () => openDetails(sessionId) }, "详情"),
              )
            : null,
          e(
            "button",
            {
              type: "button",
              className: "pp-star",
              "data-busy": busy ? "true" : "false",
              disabled: empty || busyPhase,
              title,
              "aria-label": "优化输入",
              // 保住编辑器焦点：不抢 focus，回填时才不需要再点回输入框。
              onMouseDown: (event) => event.preventDefault(),
              onPointerDown: startPress,
              onPointerUp: endPress,
              onPointerLeave: endPress,
              onPointerCancel: endPress,
              onContextMenu: (event) => {
                event.preventDefault();
                openMenu();
              },
              onClick,
            },
            e(SparkleGlyph, null),
          ),
          panel.menuOpen
            ? e(
                "div",
                { className: "pp-menu", ref: menuRef, role: "menu", "aria-label": "优化设置" },
                LEVELS.concat([]).length > 0
                  ? e(
                      "button",
                      {
                        type: "button",
                        role: "menuitemradio",
                        className: "pp-menu-item",
                        "aria-checked": panel.level === AUTO,
                        onClick: () => pickLevel(AUTO),
                      },
                      "智能",
                      e("span", { className: "pp-menu-side" }, "按原文自动选档"),
                    )
                  : null,
                LEVELS.map((item) =>
                  e(
                    "button",
                    {
                      key: item.id,
                      type: "button",
                      role: "menuitemradio",
                      className: "pp-menu-item",
                      "aria-checked": panel.level === item.id,
                      title: item.hint,
                      onClick: () => pickLevel(item.id),
                    },
                    item.label,
                    e("span", { className: "pp-menu-side" }, item.hint),
                  ),
                ),
                e("div", { className: "pp-menu-sep" }),
                e(
                  "button",
                  {
                    type: "button",
                    role: "menuitemradio",
                    className: "pp-menu-item",
                    "aria-checked": panel.mode === "instant",
                    onClick: () => pickMode("instant"),
                  },
                  "直接回填",
                  e("span", { className: "pp-menu-side" }, "点一下就替换"),
                ),
                e(
                  "button",
                  {
                    type: "button",
                    role: "menuitemradio",
                    className: "pp-menu-item",
                    "aria-checked": panel.mode === "preview",
                    onClick: () => pickMode("preview"),
                  },
                  "先预览",
                  e("span", { className: "pp-menu-side" }, "确认后再写回"),
                ),
                e("div", { className: "pp-menu-note" }, "长按或右键呼出 · Ctrl+Alt+P"),
              )
            : null,
        ),
      );
    }
    //#endregion

    //#region dsh-prompt-polish: remote contribution
    /**
     * 客户端 face 的 Remote 清单：等价于 createTypertRemoteInfo 的产物，
     * 由 ctx.remote.$mount() 挂载后才有 `ctx.remote.promptPolish.polish`。
     * 只声明 direct 调用，不声明 scoped 投影，所以 descriptors 里不放 input/invoke。
     */
    const remoteCodec = (typeSymbol) => ({
      mode: "strict",
      typeSymbol,
      create: () => ({ parse: (value) => value }),
    });
    const polishDescriptor = {
      id: "dsh-prompt-polish#promptPolish/polish",
      service: "promptPolish",
      namespace: "promptPolish",
      method: "polish",
      description: "按档位（smooth/structure/instruction）优化一段输入框草稿。",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "request",
          wire: "request",
          source: "json",
          codec: remoteCodec("dsh-prompt-polish#PolishRequest"),
        },
      ],
      result: remoteCodec("dsh-prompt-polish#PolishResult"),
    };
    const REMOTE_CONTRIBUTION = {
      package: "dsh-prompt-polish",
      descriptors: [polishDescriptor],
      methods: { "promptPolish/polish": polishDescriptor },
    };
    //#endregion

    //#region dsh-prompt-polish: plugin body
    /** 依赖：slot 注册表 + Remote 服务（自己的命名空间在 apply 里手动 $mount）。 */
    const inject = ["slots", "remote"];

    /** 一个普通的「优化」快捷键声明，UI 与快捷键共用同一份。 */
    const SHORTCUT = {
      id: "promptPolish.open",
      label: () => "优化输入",
      aliases: ["polish prompt", "优化输入", "润色"],
      defaults: {
        "desktop:macos": { code: "KeyP", modifiers: ["primary", "alt"] },
        "desktop:windows": { code: "KeyP", modifiers: ["primary", "alt"] },
        "desktop:linux": { code: "KeyP", modifiers: ["primary", "alt"] },
        "web:macos": { code: "KeyP", modifiers: ["primary", "alt"] },
        "web:windows": { code: "KeyP", modifiers: ["primary", "alt"] },
        "web:linux": { code: "KeyP", modifiers: ["primary", "alt"] },
      },
      regions: ["page", "editable"],
      modals: [],
      resolve: () => {
        if (activeStarter === null) return { status: "blocked", reason: "把光标放进输入框再用" };
        return {
          status: "handled",
          run: () => {
            try {
              activeStarter();
            } catch (error) {
              console.warn("[dsh-prompt-polish] open failed:", error);
            }
          },
        };
      },
    };

    /**
     * 把一个已挂载 Remote 的上下文装成 UI：slot 入口 + 可发现快捷键。
     * @param child - 注入了 `remote.promptPolish` 的子上下文。
     */
    function registerUi(child) {
      child.slots.inject("conversation.input.dock", () =>
        child.slots.register(
          {
            name: "conversation.input.dock",
            id: "prompt-polish",
            order: 40,
            inject: (sessionId) => ({ sessionId, polishCtx: child }),
          },
          Dock,
        ),
      );

      // 快捷键服务按可用性取用：拿不到就只保留 DOM 监听那一层。
      try {
        const shortcuts = child.get("shortcuts");
        if (shortcuts !== undefined && typeof shortcuts.register === "function") {
          child.effect(() => shortcuts.register(SHORTCUT), "dsh-prompt-polish: command");
        }
      } catch (error) {
        console.warn("[dsh-prompt-polish] shortcut registration skipped:", error);
      }
    }

    /**
     * 挂载：先把自己的 Remote 命名空间装上，再在注入了该命名空间的子上下文里装 UI。
     * @param ctx - 浏览器侧 cordis 上下文。
     * @returns 卸载器（同时撤 UI 与 Remote）。
     */
    async function apply(ctx) {
      let unmountRemote = null;
      try {
        unmountRemote = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
      } catch (error) {
        console.warn("[dsh-prompt-polish] remote mount failed:", error);
      }
      const ui = ctx.inject(["remote.promptPolish"], registerUi);
      try {
        await ui;
      } catch (error) {
        console.warn("[dsh-prompt-polish] ui mount failed:", error);
        await ui.dispose();
        if (unmountRemote !== null) await unmountRemote();
        return;
      }
      return async () => {
        await ui.dispose();
        if (unmountRemote !== null) await unmountRemote();
      };
    }
    //#endregion

    exports.inject = inject;
    exports.apply = apply;
    exports.Dock = Dock;
    return module.exports;
  },
});
