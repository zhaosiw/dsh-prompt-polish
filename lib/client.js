// dsh-prompt-polish — 浏览器半区（client plugin bundle）。
//
// 由 dsh-client-modules 在 /plugins/dsh-prompt-polish/client.js 提供，经 vendored
// cordis Loader 的 lazy-CJS 模块表执行（window.__ModuleLoader__.load）。factory 体是
// 纯 CJS：require() 从 shell 模块表解析，与官方 ui-* 包的 tsdown 产物同形。
//
// 职责：在输入卡片底部工具栏（模型名左侧）挂一颗星：点一下 → 草稿交给 Host 的
// remote.promptPolish.polish() → 就地替换输入框内容 → 角上留一条「已优化 · 撤销」。
// 没有档位、没有菜单、没有预览：深度由模型自己判断，用户不需要做任何选择。
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
      /* 一个不会撑开工具栏的内联座位：提示条绝对定位，不挤压模型名与发送键 */
      ".pp-slot{position:relative;display:inline-flex;align-items:center;flex:none}",
      ".pp-star{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);flex:none;transition:color .12s ease,background .12s ease}",
      ".pp-star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}",
      ".pp-star:active{transform:scale(.94)}",
      ".pp-star[data-busy='true']{color:var(--dsw-alias-brand-primary);cursor:progress}",
      ".pp-star[disabled]{opacity:.38;cursor:default;background:transparent;color:var(--dsw-alias-label-tertiary)}",
      ".pp-star svg{width:15px;height:15px;display:block}",
      ".pp-star[data-busy='true'] svg{animation:pp-spin 1.3s linear infinite}",
      "@keyframes pp-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}",
      /* 结果提示条：浮在按钮上方，12 秒后自己消失 */
      ".pp-note{position:absolute;bottom:calc(100% + 8px);right:-4px;z-index:60;display:flex;align-items:center;gap:8px;max-width:min(72vw,420px);padding:5px 9px;border:1px solid var(--dsw-alias-border-l,rgba(127,127,127,.28));border-radius:9px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 8px 22px rgba(0,0,0,.16);font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
      ".pp-note[data-kind='error']{color:var(--dsw-alias-state-error-primary,#e5484d)}",
      ".pp-note-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".pp-link{padding:0 2px;border:0;background:transparent;font:inherit;font-size:12px;line-height:16px;color:var(--dsw-alias-brand-primary);cursor:pointer;flex:none}",
      ".pp-link:hover{text-decoration:underline}",
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

    /**
     * 深度由客户端按草稿体量挑一档，用户看不到也不需要选：
     * 一句话就是顺一下语法，中等长度补结构和约束，长段落重组为可执行指令。
     * 这一档只作为 wire 上的兼容字段（Host 新旧两版都能吃），不是给用户的选项。
     */
    const depthOf = (text) => {
      const body = String(text ?? "");
      const lines = body.split("\n").length;
      if (body.length <= 42 && lines <= 2) return "smooth";
      if (body.length <= 220 && lines <= 6) return "structure";
      return "instruction";
    };

    /** 每个 Session 一份状态：请求中 / 上一次结果（可撤销）/ 上一次错误（可重试）。 */
    const states = new Map();
    const listeners = new Set();
    const starters = new Map();
    const hideTimers = new Map();
    let activeStarter = null;

    const stateOf = (sid) => {
      let state = states.get(sid);
      if (state === undefined) {
        state = { busy: false, notice: null, seq: 0 };
        states.set(sid, state);
      }
      return state;
    };
    const update = (sid, patch) => {
      states.set(sid, { ...stateOf(sid), ...patch });
      for (const listener of [...listeners]) listener(sid);
    };
    const subscribe = (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const clearHideTimer = (sid) => {
      const running = hideTimers.get(sid);
      if (running !== undefined) clearTimeout(running);
      hideTimers.delete(sid);
    };
    const armHide = (sid, ms) => {
      clearHideTimer(sid);
      const timer = setTimeout(() => {
        hideTimers.delete(sid);
        if (stateOf(sid).busy) return;
        update(sid, { notice: null });
      }, ms);
      hideTimers.set(sid, timer);
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
     * 唯一的一条路径：抓草稿 → 请模型优化 → 直接写回 → 留 12 秒撤销口。
     * 没有档位可选、没有预览确认，用户只做「点一下」这一个动作。
     */
    function runPolish(props, sessionId) {
      const actions = props.inputActions;
      const draft = typeof props.input?.draft === "string" ? props.input.draft : "";
      const state = stateOf(sessionId);
      if (state.busy) return;
      if (draft.trim() === "") {
        update(sessionId, { notice: { kind: "error", message: "先写点内容" } });
        armHide(sessionId, 4000);
        return;
      }
      const remote = remoteOf(props.polishCtx);
      if (remote === null || typeof remote.polish !== "function") {
        update(sessionId, { notice: { kind: "error", message: "优化服务未就绪，重启 DSH 后重试" } });
        armHide(sessionId, 6000);
        return;
      }
      const seq = state.seq + 1;
      clearHideTimer(sessionId);
      update(sessionId, { busy: true, seq, notice: null });
      const startedAt = Date.now();
      const fail = (message, raw) => {
        update(sessionId, { busy: false, notice: { kind: "error", message, raw: raw === undefined ? "" : JSON.stringify(raw).slice(0, 900) } });
        armHide(sessionId, 6000);
      };
      Promise.resolve(remote.polish({ text: draft, level: depthOf(draft), locale: localeOf() })).then(
        (raw) => {
          if (stateOf(sessionId).seq !== seq) return;
          const response = unwrapRpc(raw);
          if (response === null || typeof response !== "object" || response.ok !== true) {
            fail(response?.message || "优化失败，请重试", response);
            return;
          }
          const text = String(response.text ?? "");
          if (text.trim() === "") {
            fail("模型这次没给出结果，再点一次");
            return;
          }
          // 兜底护栏：万一把模型裸 JSON 当正文返回，也绝不写进输入框。
          if (/^\s*\{\s*"text"\s*:/.test(text)) {
            fail("输出不完整，没有写回输入框，再点一次");
            return;
          }
          actions?.setDraft?.(text);
          update(sessionId, {
            busy: false,
            notice: {
              kind: "done",
              before: draft,
              after: text,
              missing: missingTokens(draft, text),
              elapsed: Date.now() - startedAt,
              version: String(response.version ?? ''),
            },
          });
          armHide(sessionId, 12000);
        },
        (error) => {
          if (stateOf(sessionId).seq !== seq) return;
          fail(error instanceof Error ? error.message : String(error));
        },
      );
    }

    /** 撤销：草稿原样换回点击前的那份快照。 */
    function undo(props, sessionId) {
      const notice = stateOf(sessionId).notice;
      if (notice === null || notice.kind !== "done") return;
      props.inputActions?.setDraft?.(notice.before);
      clearHideTimer(sessionId);
      update(sessionId, { notice: null });
    }
    //#endregion

    //#region dsh-prompt-polish: components
    /** 一颗四角星：不解释，就是一个图标。 */
    function SparkleGlyph() {
      return e(
        "svg",
        { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", focusable: "false" },
        e("path", {
          d: "M12 3.2c.3 3.6 1.7 5.6 3.2 6.9 1.4 1.2 3.3 1.8 5.6 2-.9.2-1.9.6-2.9 1.2-2.2 1.3-3.7 3.3-4.6 6.5-.2-2-1-3.6-2.2-4.9-1.3-1.4-3-2.2-5.1-2.6 2-.4 3.5-1.1 4.6-2.2C10.8 9 11.7 6.6 12 3.2Z",
          fill: "currentColor",
          stroke: "currentColor",
          strokeWidth: "1.1",
          strokeLinejoin: "round",
        }),
      );
    }

    function Notice(props) {
      const notice = props.notice;
      const isError = notice.kind === "error";
      return e(
        "div",
        { className: "pp-note", "data-kind": notice.kind, role: "status", "data-pp-raw": notice.raw ?? "" },
        e(
          "span",
          { className: "pp-note-text", title: (notice.missing ?? []).length > 0 ? "未保留：" + notice.missing.join(" ") : undefined },
          isError ? notice.message : "已优化",
        ),
        e(
          "button",
          {
            type: "button",
            className: "pp-link",
            // 保住编辑器焦点：撤销后直接接着打字。
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => (isError ? runPolish(props.props, props.sessionId) : undo(props.props, props.sessionId)),
          },
          isError ? "重试" : "撤销",
        ),
      );
    }

    /**
     * 输入卡片底部工具栏里的一颗星。props.input / props.inputActions / props.sessionId
     * 由 conversation 的 slot 注入提供。
     */
    function StarButton(props) {
      const sessionId = String(props.sessionId ?? props.session?.sessionId ?? props.session?.id ?? "default");
      // slot 注入的草稿可能有两个来源：直接给的 props.input，或 uiSession.provide 的
      // hooks.input（以 useInput 形式变成 prop）。两个都拿，谁有值用谁。
      const useInput = typeof props.useInput === "function" ? props.useInput : null;
      const hooked = useInput === null ? undefined : useInput((snapshot) => snapshot);
      const input = hooked ?? props.input;
      const draft = typeof input?.draft === "string" ? input.draft : "";
      const inputActions = props.inputActions ?? input?.actions;
      const [state, setState] = React.useState(() => stateOf(sessionId));
      const rootRef = React.useRef(null);
      // 统一成一份「活 props」：下游（runPolish/undo/Notice）只认 input 与 inputActions。
      const live = { ...props, input, inputActions };
      const latest = React.useRef({ props: live, sessionId });
      latest.current = { props: live, sessionId };

      React.useEffect(() => {
        setState(stateOf(sessionId));
        return subscribe((changed) => {
          if (changed === sessionId) setState(stateOf(sessionId));
        });
      }, [sessionId]);

      // 注册本 Session 的启动器，供快捷键（Host 侧命令）调用。
      React.useEffect(() => {
        const starter = () => runPolish(latest.current.props, sessionId);
        starters.set(sessionId, starter);
        return () => {
          if (starters.get(sessionId) === starter) starters.delete(sessionId);
          if (activeStarter === starter) activeStarter = null;
        };
      }, [sessionId]);

      // 输入区上的快捷键：Ctrl/Cmd + Alt + P（捕获阶段先于编辑器）。
      React.useEffect(() => {
        const node = rootRef.current;
        if (node === null) return;
        let host = node;
        for (let depth = 0; depth < 6; depth += 1) {
          if (host.parentElement === null) break;
          host = host.parentElement;
          const editable = host.querySelector?.('[contenteditable="true"], textarea');
          if (editable !== null && editable !== undefined) break;
        }
        const mark = () => {
          const starter = starters.get(sessionId);
          if (starter !== undefined) activeStarter = starter;
        };
        const onKeyDown = (event) => {
          if (event.code !== "KeyP" || !event.altKey || !(event.ctrlKey || event.metaKey) || event.shiftKey) return;
          event.preventDefault();
          event.stopPropagation();
          mark();
          runPolish(latest.current.props, sessionId);
        };
        host.addEventListener("pointerdown", mark, true);
        host.addEventListener("focusin", mark, true);
        host.addEventListener("keydown", onKeyDown, true);
        return () => {
          host.removeEventListener("pointerdown", mark, true);
          host.removeEventListener("focusin", mark, true);
          host.removeEventListener("keydown", onKeyDown, true);
        };
      }, [sessionId]);

      const empty = draft.trim() === "";
      const phase = input?.phase;
      const locked = phase === "submitting" || phase === "adjudicating";
      const busy = state.busy === true || locked;
      const title = empty ? "先写点内容" : locked ? "发送中，稍后再优化" : "优化输入 · Ctrl+Alt+P";

      return e(
        "div",
        { className: "pp-slot", ref: rootRef, "data-prompt-polish": true },
        state.notice === null
          ? null
          : e(Notice, { notice: state.notice, props: latest.current.props, sessionId, key: "notice-" + state.notice.kind }),
        e(
          "button",
          {
            type: "button",
            className: "pp-star",
            "data-busy": busy ? "true" : "false",
            // 诊断用：能直接看出 slot 到底注入了哪些 prop、草稿长度、来源。
            "data-pp-keys": Object.keys(props || {}).join(","),
            "data-pp-draft": String(draft.length),
            "data-pp-src": hooked !== undefined ? "hook" : props.input !== undefined ? "prop" : "none",
            "data-pp-host": state.notice?.version ?? "",
            disabled: empty || locked,
            title,
            "aria-label": "优化输入",
            // 保住编辑器焦点：不抢 focus，回填后不需要再点回输入框。
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => runPolish(latest.current.props, sessionId),
          },
          e(SparkleGlyph, null),
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
      description: "把一段输入框草稿优化成更清楚可执行的一段话。",
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
     * 把一个已挂载 Remote 的上下文装成 UI：工具栏里一颗星 + 可发现快捷键。
     * @param child - 注入了 `remote.promptPolish` 的子上下文。
     */
    function registerUi(child) {
      // 输入卡片底部工具栏，挤在模型名左侧、发送键一侧 —— 按钮在对话框里面。
      child.slots.inject("conversation.input.right", () =>
        child.slots.register(
          {
            name: "conversation.input.right",
            id: "prompt-polish",
            order: 10,
            inject: (sessionId) => ({ sessionId, polishCtx: child }),
          },
          StarButton,
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
    exports.Dock = StarButton;
    return module.exports;
  },
});
