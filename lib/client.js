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
    const readLevel = () => {
      try {
        const saved = globalThis.localStorage?.getItem(LEVEL_STORAGE_KEY);
        return LEVELS.some((item) => item.id === saved) ? saved : "structure";
      } catch {
        return "structure";
      }
    };
    const saveLevel = (id) => {
      try {
        globalThis.localStorage?.setItem(LEVEL_STORAGE_KEY, id);
      } catch {
        /* 存储不可用时只在本次会话内生效 */
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
    let activeStarter = null;
    const panelOf = (sid) => {
      let panel = panels.get(sid);
      if (panel === undefined) {
        panel = { open: false, level: readLevel(), phase: "idle", result: null, edited: "", error: "", warning: "", missing: [], snapshot: null, seq: 0 };
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
    /**
     * 一次优化请求：抓草稿（有选区则只优化选区）→ 调 Host → 写回面板状态。
     * 结果只进面板，草稿在用户确认前不动。
     */
    function runPolish(props, sessionId, levelOverride) {
      const input = props.input;
      const actions = props.inputActions;
      const draft = typeof input?.draft === "string" ? input.draft : "";
      const panel = panelOf(sessionId);
      const level = LEVELS.some((item) => item.id === levelOverride) ? levelOverride : panel.level;
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
      const seq = panel.seq + 1;
      updatePanel(sessionId, {
        open: true,
        phase: "loading",
        level,
        error: "",
        warning: "",
        missing: [],
        result: null,
        edited: "",
        snapshot: { text: draft, target, span },
        seq,
      });
      Promise.resolve(remote.polish({ text: target, level, locale: localeOf() })).then(
        (raw) => {
          if (panelOf(sessionId).seq !== seq) return;
          const response = unwrapRpc(raw);
          if (response === null || typeof response !== "object" || response.ok !== true) {
            updatePanel(sessionId, { phase: "error", error: response?.message || "优化失败，请重试" });
            return;
          }
          updatePanel(sessionId, {
            phase: "ready",
            result: response,
            edited: response.text,
            missing: missingTokens(target, response.text),
          });
        },
        (error) => {
          if (panelOf(sessionId).seq !== seq) return;
          updatePanel(sessionId, { phase: "error", error: error instanceof Error ? error.message : String(error) });
        },
      );
    }

    /** 确认插入：选区走 insertText（原子可撤销），整段走 setDraft。 */
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

    const closePanel = (sessionId) => {
      const panel = panelOf(sessionId);
      updatePanel(sessionId, { open: false, phase: "idle", result: null, edited: "", error: "", warning: "", snapshot: null, seq: panel.seq + 1 });
    };
    //#endregion

    //#region dsh-prompt-polish: components
    function LevelBar({ level, onPick }) {
      return e(
        "div",
        { className: "pp-levels", role: "group", "aria-label": "优化档位" },
        LEVELS.map((item) =>
          e(
            "button",
            {
              key: item.id,
              type: "button",
              className: "pp-level",
              "aria-pressed": item.id === level,
              title: item.hint,
              onClick: () => onPick(item.id),
            },
            item.label,
          ),
        ),
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
      return e(
        React.Fragment,
        null,
        e("textarea", {
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
            { className: "pp-hint", style: { marginRight: "auto" } },
            (result.model ? result.model + " · " : "") + (result.levelLabel ?? ""),
          ),
          e("button", { type: "button", className: "pp-btn", onClick: onClose }, "取消"),
          e("button", { type: "button", className: "pp-btn primary", onClick: () => confirmInsert(props, sessionId, false) }, "确认插入"),
        ),
      );
    }

    function Dock(props) {
      const sessionId = String(props.sessionId ?? props.session?.sessionId ?? props.session?.id ?? "default");
      const input = props.input;
      const draft = typeof input?.draft === "string" ? input.draft : "";
      const [panel, setPanel] = React.useState(() => panelOf(sessionId));
      const rootRef = React.useRef(null);
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
        if (!panel.open) return;
        const onKey = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closePanel(sessionId);
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            confirmInsert(latest.current.props, sessionId, false);
          }
        };
        document.addEventListener("keydown", onKey, true);
        return () => document.removeEventListener("keydown", onKey, true);
      }, [panel.open, sessionId]);

      const pickLevel = (id) => {
        saveLevel(id);
        updatePanel(sessionId, { level: id });
        if (panel.open) runPolish(props, sessionId, id);
      };
      const empty = draft.trim() === "";
      const open = panel.open;
      // 提交/裁决相位时编辑器不接受插入，这里同步禁用并给出原因。
      const phase = input?.phase;
      const busy = phase === "submitting" || phase === "adjudicating";
      const blockedReason = empty ? "先写点内容再优化" : busy ? "发送中，稍后再优化" : "优化输入（Ctrl+Alt+P）";

      return e(
        "div",
        { className: "pp-root", ref: rootRef, "data-prompt-polish": true },
        open
          ? e(
              "div",
              { className: "pp-panel", role: "dialog", "aria-label": "优化输入" },
              e(
                "div",
                { className: "pp-head" },
                e("span", { className: "pp-title" }, "优化输入"),
                e(LevelBar, { level: panel.level, onPick: pickLevel }),
                e("button", { type: "button", className: "pp-close", onClick: () => closePanel(sessionId), "aria-label": "关闭" }, "×"),
              ),
              e(PanelBody, { panel, sessionId, props, onClose: () => closePanel(sessionId) }),
            )
          : null,
        e(
          "div",
          { className: "pp-dock" },
          e(
            "button",
            {
              type: "button",
              className: "pp-trigger",
              disabled: empty || busy,
              title: blockedReason,
              // 保住编辑器焦点：不抢 focus，回填时才不需要再点回输入框。
              onMouseDown: (event) => event.preventDefault(),
              onClick: () => (open ? closePanel(sessionId) : runPolish(props, sessionId)),
            },
            e("span", { className: "pp-mark" }, "Aa"),
            e("span", null, "优化"),
            e("span", { className: "pp-kbd" }, "Ctrl+Alt+P"),
          ),
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
