// Babel Tower - 设置面板 UI(2026-10-28 任务②C-1:从 lingua_chat.js 拆分)
// ------------------------------------------------------------------
// 用途:游戏内设置面板的全部 UI 逻辑 —— 开关/下拉/文本框、面板回填与保存、服务商测试
//   (桥读写仍走核心 bridgePost;状态行仍走核心 setStatus)。
// 装载顺序契约:必须在 lingua_chat.vjs_c **之后**(chat.xml/hudchat.xml:主脚本 → 本文件 → 探针)。
//   本文件经 globalThis.LCTNS 导入宿主符号 —— 宿主先求值并发布 LCTNS。顺序错了就直接静默
//   退出(见下方守卫):设置按钮变无操作,聊天主流程不受影响(与 exp 探针文件同一防御策略)。
// 发布(globalThis,供 XML onactivate 直调 + 主文件块外晚绑定调用,勿改名):
//   LCTToggleSettings / LCTCloseSettings / LCTEntryBlur / LCTEntryKey / LCTOnToggle /
//   LCTPickProvider / LCTCycle / LCTToggleMenu / LCTPickLang / LCTPickOption / LCTSave / LCTTest /
//   openSettingsPanel / closeSettingsPanel / syncPanelFromConfig / syncCustomInputs /
//   collectPanelConfig / fieldValue / setSelectText / setToggleText / labelFor / cycleValue /
//   closeSelectMenus / setFieldText / SELECT_MENU_IDS / credFieldSnap
// 依赖(全部经 LCTNS 导入,缺一个 = 运行期 ReferenceError):
//   State, t, findChild, getRoot, hasClass, safeText, log, saveUiConfig, setStatus,
//   updateBridgeStatusUI, bridgePost, markCfgDirty, SETTINGS_PANEL_ID,
//   SETTINGS_VISIBLE_CLASS, CHAT_INPUT_ID, PROVIDER_OPTIONS, LANGUAGE_OPTIONS, DISPLAY_MODES,
//   OUTGOING_MODES, UI_LANG_OPTIONS
// 未搬(留主文件):setStatus、bridgePost、BTIPC_GET_OPS、applyUILang、LCTPickUILang。
(() => {
  "use strict";

  var L = globalThis.LCTNS;
  if (!L) {
    // 装载顺序错误:给一条可见日志(simtest 里 console 存在;游戏里退化为静默)
    try { if (globalThis.console && globalThis.console.log) globalThis.console.log("[LCT] panel skipped: LCTNS missing (load order)"); } catch (e) {}
    return;
  }
  // 别名导入核心顶层绑定(与核心 LCTNS 发布名单对账,tests/lc_p4_partition.test.js 钉)
  const { State, t, findChild, getRoot, hasClass, safeText, log, saveUiConfig, setStatus, updateBridgeStatusUI, bridgePost, markCfgDirty, SETTINGS_PANEL_ID, SETTINGS_VISIBLE_CLASS, CHAT_INPUT_ID, PROVIDER_OPTIONS, LANGUAGE_OPTIONS, DISPLAY_MODES, OUTGOING_MODES, UI_LANG_OPTIONS } = L;

  // ================= 设置面板(自核心迁入,函数体零改写)================
  function openSettingsPanel() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (!panel) return;
    try {
      panel.AddClass(SETTINGS_VISIBLE_CLASS);
    } catch (e) {}
    try {
      if (typeof panel.SetHasClass === "function") panel.SetHasClass(SETTINGS_VISIBLE_CLASS, true);
    } catch (e) {}
    syncPanelFromConfig();
    // btipc05b:开机读到的 mask(存 State.cfg._mask)直接秒开面板 —— 现场读应答
    // ≈400B=40 帧 × 真机 600ms/帧 ≈24s,开面板当场读会占死 BTIPC 槽一整拍
    // (期间点保存要排队,超 12s 还会掉死通道)。只有开机时桥不在(没同步到)
    // 才走现场慢读兜底。
    if (State.cfg._mask) {
      applyConfigToPanel(State.cfg._mask);
    } else {
      // 从桥拉取已保存配置:回填 UI 偏好(游戏重启后恢复) + apiKey 占位符
      bridgePost("config", {}, function (res) {
        if (res && res.ok && res.config) {
          State.cfg._mask = res.config;
          applyConfigToPanel(res.config);
        }
      });
    }
    // mask → 面板回填块(开机秒开与异步回填共用;函数声明提升,先用后声明合法)
    function applyConfigToPanel(c) {
      if (!c) return;
        if (c.ui) {
          let changed = false;
          const dirty = State.cfgDirty || {}; // 2026-10-16:开面板回填同样不得拍掉未存的 picks
          if (typeof c.ui.displayMode === "string" && !dirty.displayMode) { State.cfg.displayMode = c.ui.displayMode; changed = true; }
          if (typeof c.ui.outgoing === "string" && !dirty.outgoing) { State.cfg.outgoing = c.ui.outgoing; changed = true; }
          if (typeof c.ui.outgoingTarget === "string" && !dirty.outgoingTarget) { State.cfg.outgoingTarget = c.ui.outgoingTarget; changed = true; }
          if (typeof c.ui.targetLanguage === "string" && !dirty.targetLanguage) { State.cfg.targetLanguage = c.ui.targetLanguage; changed = true; }
          if (typeof c.ui.enabled === "boolean" && !dirty.enabled) { State.cfg.enabled = c.ui.enabled; changed = true; }
          if (typeof c.ui.force === "boolean" && !dirty.force) { State.cfg.force = c.ui.force; changed = true; }
          if (typeof c.ui.provider === "string" && !dirty.provider) { State.cfg.provider = c.ui.provider; changed = true; }
          if (typeof c.ui.timeoutMs === "number" && !dirty.timeoutMs) { State.cfg.timeoutMs = c.ui.timeoutMs; changed = true; }
          if (changed) {
            syncPanelFromConfig();
            saveUiConfig();
          }
        }
        // 记录各服务商是否已配置 Key(供 collectPanelConfig 防误清空)
        State.cfg._providerKeys = {
          microsoft: !!(c.microsoft && c.microsoft.hasApiKey),
          openai: !!(c.openai && c.openai.hasApiKey),
          deepl: !!(c.deepl && c.deepl.hasApiKey),
          google: !!(c.google && c.google.hasApiKey),
        };
        // apiKey 占位符必须在 syncPanelFromConfig 之后设置(否则会被其清空)
        if (c.microsoft && c.microsoft.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.openai && c.openai.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.deepl && c.deepl.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        if (c.google && c.google.hasApiKey) { setFieldText("LCTApiKey", "********"); credFieldSnap.apiKey = "********"; }
        // 回填已保存的 Microsoft 区域(region 非机密,直接明文回显),否则每次打开都是空
        if (c.microsoft && c.microsoft.region) {
          setFieldText("LCTRegion", String(c.microsoft.region));
          credFieldSnap.region = String(c.microsoft.region);
        }
        if (c.openai && c.openai.baseUrl) setFieldText("LCTOpenaiBaseUrl", c.openai.baseUrl);
        if (c.openai && c.openai.model) setFieldText("LCTOpenaiModel", c.openai.model);
        if (c.deepl && c.deepl.endpoint) setFieldText("LCTDeeplEndpoint", c.deepl.endpoint);
        if (Array.isArray(c.fallbackProviders)) {
          const fbStr = c.fallbackProviders.join(",");
          setFieldText("LCTFallback", fbStr);
          credFieldSnap.fallback = fbStr;
        }
        if (c.chatLog && typeof c.chatLog.enabled === "boolean") {
          if (!((State.cfgDirty || {}).chatLog)) State.cfg.chatLog = c.chatLog.enabled;
          setToggleText("LCTChatLog", State.cfg.chatLog);
        }
        if (typeof c.translateOwn === "boolean") {
          if (!((State.cfgDirty || {}).translateOwn)) State.cfg.translateOwn = c.translateOwn;
          setToggleText("LCTTranslateOwn", State.cfg.translateOwn);
        }
    }
    // 聚焦面板本身(与 DLCT 一致:优先控件,失败则面板;面板持焦后 Tab/Enter 可用)
    try {
      const first = findChild(panel, "LCTEnabled");
      if (first && first.SetFocus) first.SetFocus();
      else if (panel.SetFocus) panel.SetFocus();
    } catch (e) {}
  }

  function closeSettingsPanel() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (panel) {
      try {
        panel.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    // 注意:不要在这里 SetFocus(root)!!
    // root 是 HUD 根面板, SetFocus 后键盘焦点被 UI 层吃掉, 游戏收不到按键
    // (V3 实测: 鼠标恢复了但键盘死掉 —— 就是这行 root.SetFocus() 干的)
    // 正确做法: 焦点已在 LCTEntryBlur 里通过 CitadelChatInputBlur+DropInputFocus 还给引擎
  }

  function LCTToggleSettings() {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    if (panel && hasClass(panel, SETTINGS_VISIBLE_CLASS)) closeSettingsPanel();
    else openSettingsPanel();
  }

  function LCTCloseSettings() {
    log("close clicked");
    closeSettingsPanel();
  }

  // TextEntry 失焦恢复:释放输入焦点 + 走原版 ChatInput 路径退出引擎文本输入模式
  // 修复 Deadlock FPS 引擎对 TextEntry 焦点隐藏鼠标/锁键盘的问题
  // 关键(从原版聊天发送链路 poker_chat_debug.js 确认):
  //   引擎的键盘模式由 CitadelChat 面板体系(ChatInput)控制。
  //   发送后恢复 = $.DispatchEvent("CitadelChatInputBlur", ChatInput) + DropInputFocus(ChatInput)
  // V4 失败原因:把 CitadelChatInputBlur 派发到了我们自己的 entry(非 ChatInput) → 引擎不认识,静默忽略
  // entry 由 XML onblur="LCTEntryBlur(this)" 显式传入 = 触发事件的 TextEntry 面板
  function LCTEntryBlur(entry) {
    // 1) 释放我们 TextEntry 的输入焦点 → 鼠标恢复
    if (entry) {
      try { $.DispatchEvent("DropInputFocus", entry); } catch (e) {}
    }
    // 2) 走原版 ChatInput 失焦路径:对原版 ChatInput 面板派发引擎事件 → 键盘回游戏
    const chatInput = State.input || findChild(getRoot(), CHAT_INPUT_ID);
    if (chatInput) {
      try { $.DispatchEvent("CitadelChatInputBlur", chatInput); } catch (e) {}
      try { $.DispatchEvent("DropInputFocus", chatInput); } catch (e) {}
    }
    // 注意: 不要 SetFocus 到 settings panel —— 那会把键盘焦点留在 UI, 游戏收不到按键
  }

  // TextEntry 按键处理:ESC 强制关闭面板+释放焦点(焦点在输入框时面板 oncancel 不触发)
  // entry 由 XML onkeydown="LCTEntryKey(event, this)" 显式传入 = 触发事件的 TextEntry 面板
  function LCTEntryKey(e, entry) {
    const k = e && (e.key || e.KeyCode);
    const kc = e && (e.KeyCode !== undefined ? e.KeyCode : e.keyCode);
    const esc = (k === "Escape" || k === "esc" || k === 27 || kc === 27);
    if (esc) {
      log("entry esc: closing settings");
      LCTEntryBlur(entry);   // 先释放焦点(entry = 真实 TextEntry, DropInputFocus 才有效)
      closeSettingsPanel();  // 再关面板(内部会把焦点还给根)
    }
    return false;
  }

  function fieldValue(id) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const field = panel ? findChild(panel, id) : null;
    return field ? safeText(field) : "";
  }

  function setFieldText(id, text) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const field = panel ? findChild(panel, id) : null;
    if (field) {
      try {
        field.text = text;
      } catch (e) {}
    }
  }

  // 凭据字段快照:记录面板当前展示的 apiKey/region 文本。
  // 保存时对比快照判断“用户真的改过”还是“字段只是被清空/占位”,避免误传空值覆盖已存配置。
  let credFieldSnap = { apiKey: "", region: "", fallback: "" };

  function syncPanelFromConfig() {
    setFieldText("LCTApiKey", "");
    setFieldText("LCTRegion", "");
    setFieldText("LCTOpenaiBaseUrl", "");
    setFieldText("LCTOpenaiModel", "");
    setFieldText("LCTDeeplEndpoint", "");
    setFieldText("LCTTargetLangCustom", "");
    setFieldText("LCTOutgoingTargetCustom", "");
    setFieldText("LCTTimeout", String(State.cfg.timeoutMs || 15000));
    setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider || "bing"));
    syncProviderRows();
    setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.targetLanguage || "zh-Hans"));
    setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode || "bilingual"));
    setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing || "off"));
    setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, State.cfg.outgoingTarget || "en"));
    setSelectText("LCTUILangSelect", labelFor(UI_LANG_OPTIONS, State.cfg.uiLang || "zh"));
    setToggleText("LCTEnabled", !!State.cfg.enabled);
    setToggleText("LCTForce", !!State.cfg.force);
    setToggleText("LCTTranslateOwn", State.cfg.translateOwn !== false);
    setToggleText("LCTChatLog", State.cfg.chatLog !== false);
    syncCustomInputs();
    closeSelectMenus();
    setStatus("");
    credFieldSnap = { apiKey: "", region: "", fallback: fieldValue("LCTFallback") }; // 字段被重置/保留,同步快照
    // 已知该服务商有 Key 时立即恢复占位符,避免中途切选项把占位符抹成空白
    if ((State.cfg._providerKeys || {})[State.cfg.provider || "bing"]) {
      setFieldText("LCTApiKey", "********");
      credFieldSnap.apiKey = "********";
    }
    updateBridgeStatusUI(); // 打开设置面板时刷新桥状态行
  }

  function setSelectText(buttonId, text) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const btn = panel ? findChild(panel, buttonId) : null;
    const label = btn ? findChild(btn, buttonId + "Label") : null;
    if (label) {
      try {
        label.text = text;
      } catch (e) {}
    }
  }

  function labelFor(options, value) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === value) return t(options[i].key);
    }
    return String(value || "");
  }

  function cycleValue(options, current) {
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].value === current) return options[(i + 1) % options.length].value;
    }
    return options[0].value;
  }

  const SELECT_MENU_IDS = [
    "LCTProviderMenu",
    "LCTTargetLangMenu",
    "LCTDisplayModeMenu",
    "LCTOutgoingMenu",
    "LCTOutgoingTargetMenu",
    "LCTUILangMenu",
  ];

  function closeSelectMenus() {
    const root = getRoot();
    for (let i = 0; i < SELECT_MENU_IDS.length; i += 1) {
      const m = findChild(root, SELECT_MENU_IDS[i]);
      if (m) {
        try {
          m.RemoveClass(SETTINGS_VISIBLE_CLASS);
        } catch (e) {}
      }
    }
  }

  // 自定义语言输入框显隐
  function syncCustomInputs() {
    const root = getRoot();
    const t = findChild(root, "LCTTargetLangCustom");
    const o = findChild(root, "LCTOutgoingTargetCustom");
    if (t) {
      try {
        if (State.cfg.targetLanguage === "custom") t.AddClass(SETTINGS_VISIBLE_CLASS);
        else t.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    if (o) {
      try {
        if (State.cfg.outgoingTarget === "custom") o.AddClass(SETTINGS_VISIBLE_CLASS);
        else o.RemoveClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
  }

  // API Key / 区域行显隐已按用户意见移除(行显隐机制不稳定,且非必需)
  function setToggleText(id, on) {
    const panel = findChild(getRoot(), SETTINGS_PANEL_ID);
    const toggle = panel ? findChild(panel, id) : null;
    if (!toggle) return;
    const label = findChild(toggle, id + "Label") || toggle;
    try {
      const lang = (State.cfg && State.cfg.uiLang) || "zh";
      label.text = on ? (lang === "en" ? "ON" : "\u662f") : (lang === "en" ? "OFF" : "\u5426");
    } catch (e) {}
  }

  function LCTOnToggle(which) {
    if (which === "enabled") {
      State.cfg.enabled = !State.cfg.enabled;
      setToggleText("LCTEnabled", State.cfg.enabled);
    } else if (which === "force") {
      State.cfg.force = !State.cfg.force;
      setToggleText("LCTForce", State.cfg.force);
    } else if (which === "chatLog") {
      State.cfg.chatLog = State.cfg.chatLog === false;
      setToggleText("LCTChatLog", State.cfg.chatLog);
      setStatus(State.cfg.chatLog ? t("msgLogOn") : t("msgLogOff"));
    } else if (which === "translateOwn") {
      State.cfg.translateOwn = State.cfg.translateOwn === false;
      setToggleText("LCTTranslateOwn", State.cfg.translateOwn);
      setStatus(State.cfg.translateOwn ? t("msgTranslateOwnOn") : t("msgTranslateOwnOff"));
    }
    markCfgDirty(which);
    saveUiConfig();
    log("toggle: " + which);
  }

  // 循环切换(服务商/显示模式/发送模式)
  // 根据当前服务商显示/隐藏对应的配置行与标签提示
  function syncProviderRows() {
    const p = State.cfg.provider || "bing";
    const setRow = function (id, show) {
      const row = findChild(getRoot(), id);
      if (!row) return;
      try {
        row.style.visibility = show ? "visible" : "collapse";
      } catch (e) {}
    };
    setRow("LCTRowApiKey", p === "microsoft" || p === "openai" || p === "deepl" || p === "google");
    setRow("LCTRowRegion", p === "microsoft");
    setRow("LCTRowOpenaiBase", p === "openai");
    setRow("LCTRowOpenaiModel", p === "openai");
    setRow("LCTRowDeeplEndpoint", p === "deepl");
    let hint = "";
    if (p === "bing") hint = t("hintBing");
    else if (p === "microsoft") hint = t("hintMicrosoft");
    else if (p === "openai") hint = t("hintOpenai");
    else if (p === "deepl") hint = t("hintDeepl");
    else if (p === "google") hint = t("hintGoogle");
    setStatus(hint);
  }

  function LCTPickProvider(value) {
    State.cfg.provider = value;
    markCfgDirty("provider");
    syncPanelFromConfig();
    saveUiConfig();
    closeSelectMenus();
    log("pickProvider: " + value);
  }

  function LCTCycle(which) {
    closeSelectMenus();
    if (which === "provider") {
      State.cfg.provider = cycleValue(PROVIDER_OPTIONS, State.cfg.provider || "bing");
      setSelectText("LCTProviderSelect", labelFor(PROVIDER_OPTIONS, State.cfg.provider));
    } else if (which === "displayMode") {
      State.cfg.displayMode = cycleValue(DISPLAY_MODES, State.cfg.displayMode || "bilingual");
      setSelectText("LCTDisplayModeSelect", labelFor(DISPLAY_MODES, State.cfg.displayMode));
    } else if (which === "outgoing") {
      State.cfg.outgoing = cycleValue(OUTGOING_MODES, State.cfg.outgoing || "off");
      setSelectText("LCTOutgoingSelect", labelFor(OUTGOING_MODES, State.cfg.outgoing));
    }
    markCfgDirty(which);
    saveUiConfig();
    log("cycle: " + which + " -> " + State.cfg[which]);
  }

  // 下拉菜单开关(目标语言/发送目标语言)
  function LCTToggleMenu(field) {
    const menuId =
      field === "uiLang" ? "LCTUILangMenu" :
      field === "targetLanguage" ? "LCTTargetLangMenu" :
      field === "outgoingTarget" ? "LCTOutgoingTargetMenu" :
      field === "provider" ? "LCTProviderMenu" :
      field === "displayMode" ? "LCTDisplayModeMenu" :
      field === "outgoing" ? "LCTOutgoingMenu" : "";
    if (!menuId) return;
    const menu = findChild(getRoot(), menuId);
    if (!menu) return;
    const isOpen = hasClass(menu, SETTINGS_VISIBLE_CLASS);
    closeSelectMenus();
    if (!isOpen) {
      try {
        menu.AddClass(SETTINGS_VISIBLE_CLASS);
      } catch (e) {}
    }
    log("menu: " + field + (isOpen ? " close" : " open"));
  }

  // 菜单选项选择
  function LCTPickLang(field, value) {
    closeSelectMenus();
    if (field === "targetLanguage") {
      State.cfg.targetLanguage = value;
      setSelectText("LCTTargetLangSelect", labelFor(LANGUAGE_OPTIONS, value));
    } else {
      State.cfg.outgoingTarget = value;
      setSelectText("LCTOutgoingTargetSelect", labelFor(LANGUAGE_OPTIONS, value));
    }
    syncCustomInputs();
    markCfgDirty(field);
    saveUiConfig();
    // 2026-10-31:选择即推桥(与 LCTPickUILang 同款)——否则面板选择只改游戏本地,
    // 网页 /tr 显示桥配置,两个 UI 分叉;且 dirty 会拦住网页修正(方向整反实证)。
    try {
      bridgePost("config", { config: { ui: (function () { const o = {}; o[field] = value; return o; })() } }, function (res) {
        log("pick persist: 推桥同步 " + field + " -> " + value + " " + (res && res.ok ? "ok" : (res && res.error) || "failed"));
        if (res && res.ok && State.cfgDirty) delete State.cfgDirty[field]; // 意图已落桥,清 dirty 让后续回填畅通
      });
    } catch (ePP) { log("pick persist THREW " + expErr(ePP)); }
    closeSelectMenus();
    log("pickLang: " + field + " -> " + value);
    if (value === "custom") {
      const customId = field === "targetLanguage" ? "LCTTargetLangCustom" : "LCTOutgoingTargetCustom";
      const custom = findChild(getRoot(), customId);
      if (custom && custom.SetFocus) {
        try {
          custom.SetFocus();
        } catch (e) {}
      }
    }
  }

  function LCTPickOption(field, value) {
    if (field === "displayMode") State.cfg.displayMode = value;
    else if (field === "outgoing") State.cfg.outgoing = value;
    else return;
    syncPanelFromConfig();
    markCfgDirty(field);
    saveUiConfig();
    closeSelectMenus();
    log("pickOption: " + field + " -> " + value);
  }

  function collectPanelConfig() {
    const customTarget = fieldValue("LCTTargetLangCustom");
    const targetLang = State.cfg.targetLanguage === "custom"
      ? (customTarget || "zh-Hans")
      : (State.cfg.targetLanguage || "zh-Hans");
    const customOut = fieldValue("LCTOutgoingTargetCustom");
    const outgoingTarget = State.cfg.outgoingTarget === "custom"
      ? (customOut || "en")
      : (State.cfg.outgoingTarget || "en");
    const prov = State.cfg.provider || "bing";
    const apiKeyField = fieldValue("LCTApiKey");
    // 面板字段为空但该服务商已有 Key:发保留标记,避免误清空(修复 /tr 重复打开后 Key 丢失)
    const apiKeyValue = (!apiKeyField && (State.cfg._providerKeys || {})[prov]) ? "********" : apiKeyField;
    // region 只有在用户真的改动了输入时才回传(对比快照);
    // 清空输入 = 显式请求清除(clearRegion),未动过 = 完全不带该字段,桥端保留原值
    const regionField = fieldValue("LCTRegion");
    const out = {
      provider: prov,
      apiKey: apiKeyValue,
      openaiBaseUrl: fieldValue("LCTOpenaiBaseUrl"),
      openaiModel: fieldValue("LCTOpenaiModel"),
      deeplEndpoint: fieldValue("LCTDeeplEndpoint"),
      targetLanguage: targetLang,
      sourceLanguage: "auto",
      displayMode: State.cfg.displayMode || "bilingual",
      outgoing: State.cfg.outgoing || "off",
      outgoingTarget: outgoingTarget,
      enabled: !!State.cfg.enabled,
      force: !!State.cfg.force,
      timeoutMs: Number(fieldValue("LCTTimeout")) || 15000,
      chatLog: State.cfg.chatLog !== false,
      translateOwn: State.cfg.translateOwn !== false,
      ui: {
        enabled: !!State.cfg.enabled,
        provider: State.cfg.provider || "bing",
        displayMode: State.cfg.displayMode || "bilingual",
        outgoing: State.cfg.outgoing || "off",
        outgoingTarget: outgoingTarget,
        targetLanguage: targetLang,
        force: !!State.cfg.force,
        timeoutMs: Number(fieldValue("LCTTimeout")) || 15000,
      },
    };
    // 仅当用户真的改动了回退列表输入时才回传;未动过/异步回填前 = 不带该字段,桥端保留原值。
    // (btipc05 bugfix:此块曾位于 const out 声明之前 —— 一旦改过回退列表就触发 TDZ
    //  ReferenceError,collectPanelConfig 抛死,保存按钮静默无反应。)
    const fbField = String(fieldValue("LCTFallback") || "");
    if (fbField !== credFieldSnap.fallback) {
      out.fallbackProviders = fbField.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    }
    // 仅当用户真的改动了区域输入时才回传;清空输入 = 显式清除
    if (regionField !== credFieldSnap.region) {
      if (regionField === "") out.clearRegion = true;
      else out.region = regionField;
    }
    return out;
  }

  function LCTSave() {
    log("save clicked");
    closeSelectMenus();
    const p = collectPanelConfig();
    bridgePost("config", { config: p }, function (res) {
      if (res && res.ok) {
        State.cfg.provider = p.provider || State.cfg.provider;
        State.cfg.targetLanguage = p.targetLanguage;
        State.cfg.displayMode = p.displayMode;
        State.cfg.outgoing = p.outgoing;
        State.cfg.outgoingTarget = p.outgoingTarget;
        State.cfg.enabled = p.enabled;
        State.cfg.force = p.force;
        State.cfg.timeoutMs = p.timeoutMs;
        State.cfg.chatLog = p.chatLog !== false;
        State.cfg.translateOwn = p.translateOwn !== false;
        // 保存成功:同步 Key 状态(新填 Key / 保留占位符都视为已有 Key)
        if (State.cfg._providerKeys) {
          State.cfg._providerKeys[p.provider || "bing"] = !!(p.apiKey && p.apiKey !== "");
        }
        syncProviderRows();
        saveUiConfig();
        // 2026-10-16:意图已落盘 —— 脏标记清零;启动期旧 _mask 作废(下次开面板走
        // https 快读,不再吃冷冻值,否则重开面板显示回旧值)
        State.cfgDirty = {};
        State.cfg._mask = null;
        setStatus(t("msgSavedWith") + (p.provider || "bing") + ")");
        log("settings saved");
      } else {
        setStatus(t("msgSaveFail") + ": " + ((res && res.error) || "unknown"));
      }
    });
  }

  function LCTTest() {
    log("test clicked");
    setStatus(t("msgTesting") + Math.round((State.cfg.timeoutMs || 15000) / 1000) + t("msgTestSec"));
    bridgePost("test", {}, function (res) {
      if (res && res.ok) setStatus(t("msgTestOk") + (res.translation || ""));
      else setStatus(t("msgTestFail") + ": " + ((res && res.error) || "unknown") + " (bridge/Key/network)");
    });
  }

  // ---- 挂回全局:XML onactivate 直调的名字 + 主文件块外晚绑定消费的名字 ----
  // 主文件里这些名字已删,裸标识符经全局对象解析到这里(装载顺序由 XML 保证)。
  globalThis.LCTToggleSettings = LCTToggleSettings;
  globalThis.LCTCloseSettings = LCTCloseSettings;
  globalThis.LCTEntryBlur = LCTEntryBlur;
  globalThis.LCTEntryKey = LCTEntryKey;
  globalThis.LCTOnToggle = LCTOnToggle;
  globalThis.LCTPickProvider = LCTPickProvider;
  globalThis.LCTCycle = LCTCycle;
  globalThis.LCTToggleMenu = LCTToggleMenu;
  globalThis.LCTPickLang = LCTPickLang;
  globalThis.LCTPickOption = LCTPickOption;
  globalThis.LCTSave = LCTSave;
  globalThis.LCTTest = LCTTest;
  globalThis.openSettingsPanel = openSettingsPanel;
  globalThis.closeSettingsPanel = closeSettingsPanel;
  globalThis.syncPanelFromConfig = syncPanelFromConfig;
  globalThis.syncCustomInputs = syncCustomInputs;
  globalThis.collectPanelConfig = collectPanelConfig;
  globalThis.fieldValue = fieldValue;
  globalThis.credFieldSnap = credFieldSnap;
  globalThis.setSelectText = setSelectText;
  globalThis.setToggleText = setToggleText;
  globalThis.labelFor = labelFor;
  globalThis.cycleValue = cycleValue;
  globalThis.closeSelectMenus = closeSelectMenus;
  globalThis.setFieldText = setFieldText;
  globalThis.SELECT_MENU_IDS = SELECT_MENU_IDS;
})();
