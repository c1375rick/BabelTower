// lingua_chat_btipc.js — BTIPC 传输层(2026-10-28 从 lingua_chat.js 拆出,主文件行数治理)
// 装载契约:必须在 lingua_chat.vjs_c 之前 include(chat.xml/hudchat.xml);
//   顶层 var LCTBTIPC 挂全局,主文件以 const 别名解构使用;依赖经 init() 注入。
// init 契约:主文件 boot() 最早处调 LCTBTIPC.init({ State, log, expErr, nowMs, ... }),
//   任何 BTIPC 方法调用(最早为 boot 后 1.2s 的 health 探针)都在其后。
// 依赖注入清单(均为主文件 script 隔离的 const/function,本文件不可直引):
//   State, log, expErr, nowMs, findChild, getRoot, isValid,
//   BRIDGE_HOST, BRIDGE_PORT, markBridgeUp, setBridgeStatus, t
var LCTBTIPC = (function () {
  "use strict";
  var D = null; // 注入的宿主依赖(LCTBTIPC.init 之前为空)

  // ============ BTIPC v1 客户端(规格 docs/btipc-v1.md;实现顺序④)=============
  // 固定窗口收包:128 个隐藏 Image 面板轮询 /btipc/dl,位=1→200(火焰)/位=0→404;
  // 每轮 16 字节帧 → 内联 CRC16 校验 → 按 seq 拼装。无 ACK:r 前进即确认,同 r 重投即重传(§4.0)。
  // API(§7 冻结 Promise 形):BTIPC.request({windowId, text, timeoutMs}) → Promise<文本>。
  // 当前回声模式(桥端③已就);⑥接翻译链后调用方不变。Panorama 无模块系统,crc16/decode 内联(§3.2 逐字节一致)。
  const BTIPC_PANEL_PREFIX = "BTIPCD"; // 0..127;与 BTBIT*/BTD*/BTE* 探针严格隔离
  const BTIPC_PANELS = 128;
  const BTIPC_FRAME_BYTES = 16;
  const BTIPC_PAYLOAD_MAX = 10;
  const BTIPC_T_CLOSE_MS = 600; // §9 常态收口(新 build bit dt P99.9 ≈ 522ms)
  const BTIPC_STORM_TCLOSE_MS = 2500; // §9 风暴收口
  const BTIPC_STORM_TRIGGER = 2; // 连续 CRC fail 轮数 → 风暴(§4.1)
  const BTIPC_STORM_ROUNDS = 4; // 风暴持续轮数
  const BTIPC_BUSY_BACKOFF_MS = 500; // BUSY 退避
  const BTIPC_T_HARD_MS = 12000; // 轮级强制闭合兜底(§4)
  const BTIPC_REQ_TIMEOUT_MS = 30000; // 消息级死线(§9)
  const BTIPC_CRC_DEAD = 8; // 同帧累计 fail 上限(§7)
  const BTIPC_ECHO_STORM_WINDOW_MS = 15000; // 回声拥塞豁免窗:失败前此窗内进过风暴 -> 判拥塞不判掉线(2026-10-12)
  const BTIPC_REQ_MAX_PAYLOAD = 680; // §9:整行(引擎前缀+[LCT]+行头+b64 908)≤1000(J1);68 帧 ≤ seq7 上限
  const BTIPC_FIRST_SHOT_DELAY_MS = 1200; // 首拍延迟:桥 tail 轮询 1000ms,防首批全 404 误触风暴
  // 死线轮询步长。死线改由 Date.now() 锚定(见 BTIPC.request 内 pollDeadline):
  // $.Schedule(N) 的 N 秒在加载窗口内会早于 Date.now() 的 N 秒触发,拿它当死线不可信。
  // 0.25s → 到点最多晚 0.25s 结算;单会话同时只有 1 个在途请求,4 次/秒空转可忽略。
  const BTIPC_DEADLINE_POLL_SEC = 0.25;

  // Date.now() 锚定的延迟结算 —— 所有「到点必须结算」的定时器走这里,不要直接
  // $.Schedule(大 N)。实测(2026-10-04 07:23):config 首读 msg=REQ_TIMEOUT 50000ms
  // 却 dt=20278ms,即 50s 的死线 21 秒就触发;窗口正好是加载进对局(Spawn Server /
  // ss_loading -> ss_active、53.5% 帧 >17.5ms),加载结束后的第二次 25.6s 走满才成功
  // —— 不是固定上限,是长延时的 $.Schedule 早于 Date.now()(同窗口 1.2s/2s/8s 的
  // 短调度都准)。Date.now() 与 console 时间戳互相印证(21s ≈ 20.278s),错的是
  // $.Schedule。早醒只重排、到点才调 fn;alive 返回假即停轮询(等价旧守卫,但不再
  // 空转)。轮询用 0.25s:到点最多晚 0.25s,单会话同时只有 1 个在途请求,开销可忽略。
  function afterRealMs(delayMs, fn, alive) {
    const at = D.nowMs() + delayMs;
    const tick = function () {
      if (alive && !alive()) return;
      if (D.nowMs() >= at) { fn(); return; }
      $.Schedule(BTIPC_DEADLINE_POLL_SEC, tick);
    };
    $.Schedule(BTIPC_DEADLINE_POLL_SEC, tick);
  }

  // ---- 内联 CRC-16/CCITT-FALSE(与 core/btipc/crc16.js 逐字节一致) ----
  function btipcCrc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc ^= (bytes[i] & 0xff) << 8;
      for (let b = 0; b < 8; b += 1) {
        crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc;
  }

  // ---- 16 字节帧解码(§3.2):CRC 不过直接拒,绝不返回半可信数据 ----
  function btipcDecodeFrame(b) {
    if (!b || b.length !== BTIPC_FRAME_BYTES) return { ok: false, reason: "size" };
    const input = [];
    for (let i = 0; i < 4; i += 1) input.push(b[i]);
    for (let i = 6; i < 16; i += 1) input.push(b[i]); // CRC 覆盖 B0..B3 + B6..B15(固定 14B,含填充)
    const calc = btipcCrc16(input);
    const got = ((b[4] & 0xff) << 8) | (b[5] & 0xff);
    if (calc !== got) return { ok: false, reason: "crc" };
    const valid = (b[3] & 0x80) !== 0;
    const len = b[3] & 0x7f;
    if (len > BTIPC_PAYLOAD_MAX) return { ok: false, reason: "format" };
    if (!valid && (b[0] !== 0 || b[3] !== 0)) return { ok: false, reason: "format" }; // BUSY 固定帧
    const payload = [];
    for (let i = 0; i < len; i += 1) payload.push(b[6 + i]);
    return {
      ok: true, valid: valid, seq: b[0] & 0x7f, end: (b[0] & 0x80) !== 0,
      id: ((b[1] & 0xff) << 8) | (b[2] & 0xff), len: len, payload: payload,
    };
  }

  // ---- UTF-8 字节 → 字符串(引擎无 TextDecoder) ----
  function btipcUtf8Decode(bytes) {
    let out = "";
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i];
      let cp = 0, extra = 0;
      if (c < 0x80) { cp = c; extra = 0; }
      else if ((c & 0xe0) === 0xc0) { cp = c & 0x1f; extra = 1; }
      else if ((c & 0xf0) === 0xe0) { cp = c & 0x0f; extra = 2; }
      else if ((c & 0xf8) === 0xf0) { cp = c & 0x07; extra = 3; }
      else { out += "\ufffd"; i += 1; continue; }
      let cont = true;
      for (let k = 1; k <= extra; k += 1) {
        const cc = bytes[i + k];
        if (cc === undefined || (cc & 0xc0) !== 0x80) { cont = false; break; }
        cp = (cp << 6) | (cc & 0x3f);
      }
      if (!cont) { out += "\ufffd"; i += 1; continue; }
      i += extra + 1;
      if (cp > 0x10ffff) { out += "\ufffd"; continue; }
      if (cp < 0x10000) out += String.fromCharCode(cp);
      else {
        const v = cp - 0x10000;
        out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      }
    }
    return out;
  }

  // ---- UTF-8 字符串 → 字节(REQ payload;代理对按码点展开) ----
  function btipcUtf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 1) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + (((cp - 0xd800) << 10) | (lo - 0xdc00)); i += 1; }
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }

  // ---- 字节 → base64(引擎无 btoa;REQ 行用) ----
  function btipcBase64(bytes) {
    const tbl = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += tbl[b0 >> 2];
      out += tbl[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? "=" : tbl[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? "=" : tbl[b2 & 63];
    }
    return out;
  }

  // ---- 面板池(128 个隐藏 2×2,复用;创建不全时下次调用重建) ----
  function btipcPanels() {
    if (D.State.btipcPanels && D.State.btipcPanels.length === BTIPC_PANELS) return D.State.btipcPanels;
    const arr = [];
    for (let i = 0; i < BTIPC_PANELS; i += 1) {
      const pid = BTIPC_PANEL_PREFIX + i;
      let p = null;
      try { p = D.findChild(D.getRoot(), pid); } catch (e) {}
      if (!D.isValid(p)) {
        try { p = $.CreatePanel("Image", D.getRoot(), pid); } catch (e) {}
        if (D.isValid(p)) {
          try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {}
        }
      }
      if (D.isValid(p)) arr.push(p);
    }
    D.State.btipcPanels = arr;
    return arr;
  }

  // ---- ImageLoaded 每会话注册一次;只认 BTIPCD* 前缀(探针 BTD*/BTBIT*/BTE* 互不干扰) ----
  function btipcEnsureHandler() {
    if (D.State.btipcHandlerOn) return;
    D.State.btipcHandlerOn = true;
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
        const st = D.State.btipcActive;
        if (!st || !st.roundOpen) return;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid.slice(0, 6) !== BTIPC_PANEL_PREFIX) return;
        const p = parseInt(pid.slice(6), 10);
        if (isNaN(p) || p < 0 || p >= BTIPC_PANELS) return;
        st.fire[p] = 1; // 同轮同面板重复 fire 幂等;上一轮迟到的 straggler 只能撞 CRC 重试(§1)
      });
    } catch (e) { D.log("btipc: ImageLoaded handler THREW " + D.expErr(e)); }
  }

  // ---- SHOT:一轮 128 发(§4);URL 对 (w,r,p) 唯一,t = 窗口号-请求号兼缓存击穿 ----
  function btipcShot(st) {
    if (D.State.btipcActive !== st) return;
    const panels = btipcPanels();
    if (panels.length < BTIPC_PANELS) {
      btipcFinish(st, false, { kind: "bridge_down", message: "panels " + panels.length + "/" + BTIPC_PANELS });
      return;
    }
    st.fire = {};
    st.roundOpen = true;
    st.roundNo += 1;
    st.shotAt = D.nowMs();
    const urlBase = "http://" + D.BRIDGE_HOST + ":" + D.BRIDGE_PORT + "/btipc/dl?w=" + st.win + "&r=" + st.r;
    // t = 窗口号-请求号-轮次。必须含 roundNo:否则同 r 重投的 128 个 URL 逐字节相同,
    // SetImage 撞同一 URL 可能不再触发 ImageLoaded → fire 永远为空 → 重试复现同一次失败(§4 要求 URL 唯一)。
    const tTag = "&t=" + st.win + "-" + st.idHex + "-" + st.roundNo;
    for (let i = 0; i < BTIPC_PANELS; i += 1) {
      try { panels[i].SetImage(urlBase + "&p=" + i + tTag); } catch (e) {}
    }
    const tClose = st.stormRounds > 0 ? BTIPC_STORM_TCLOSE_MS : BTIPC_T_CLOSE_MS;
    const myR = st.r;
    const myNo = st.roundNo;
    try {
      $.Schedule(tClose / 1000, function () { btipcClose(st, myR, myNo); });
      $.Schedule(BTIPC_T_HARD_MS / 1000, function () { btipcClose(st, myR, myNo); }); // T_HARD 兜底(守卫保证只生效一次)
    } catch (e) {
      btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + D.expErr(e) });
    }
  }

  // ---- 闭合判定(§4.0 判定表写死) ----
  function btipcClose(st, myR, myNo) {
    if (D.State.btipcActive !== st) return;
    if (!st.roundOpen || st.r !== myR || st.roundNo !== myNo) return; // 已被更早的闭合推进
    st.roundOpen = false;

    // 128 bit → 16 字节(§3.1 LSB first)
    const bytes = [];
    for (let i = 0; i < BTIPC_FRAME_BYTES; i += 1) bytes.push(0);
    for (let p = 0; p < BTIPC_PANELS; p += 1) {
      if (st.fire[p]) bytes[p >> 3] |= 1 << (p & 7);
    }
    const dt = D.nowMs() - st.shotAt;
    let d = btipcDecodeFrame(bytes);
    if (d.ok && d.id !== st.id) d = { ok: false, reason: "id_mismatch got=" + d.id }; // 防缓存串窗

    if (!d.ok) {
      st.frameFails += 1;
      st.consecutiveFails += 1;
      D.log("BTIPC: r=" + st.r + " seq=-1 len=-1 dt=" + dt + " RETRY crc=" + d.reason +
          " frameFails=" + st.frameFails + " consec=" + st.consecutiveFails);
      if (st.frameFails > BTIPC_CRC_DEAD) {
        btipcFinish(st, false, { kind: "crc_dead", message: "CRC fail " + st.frameFails + "x > " + BTIPC_CRC_DEAD });
        return;
      }
      let entered = false;
      if (st.consecutiveFails >= BTIPC_STORM_TRIGGER && st.stormRounds <= 0) {
        st.stormRounds = BTIPC_STORM_ROUNDS;
        entered = true;
        D.State.btipcLastStormAt = D.nowMs(); // 拥塞时间戳:回声超时的豁免判据
        D.log("BTIPC: STORM enter consec=" + st.consecutiveFails + " tClose=" + BTIPC_STORM_TCLOSE_MS + " rounds=" + BTIPC_STORM_ROUNDS);
      }
      const stormNow = st.stormRounds > 0;
      if (stormNow && !entered) st.stormRounds -= 1; // 进入当轮不减,保证宽收口正好 4 轮
      // 同 r 重投(§4.0);风暴期轮间 1s 冷却
      try {
        $.Schedule(stormNow ? 1.0 : 0.1, function () { btipcShot(st); });
      } catch (e) { btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + D.expErr(e) }); }
      return;
    }

    // ---- CRC ok ----
    st.frameFails = 0;
    st.consecutiveFails = 0;
    if (st.stormRounds > 0) { st.stormRounds = 0; D.log("BTIPC: STORM exit"); }

    if (!d.valid) {
      // BUSY 固定帧(§3.2):退避后**同 r 重poll**,不 r++。
      // BUSY = “本 window 的 DATA 尚未就绪”,不是新 frame;翻译等待期靠这个反复轮询。
      // 此时桥端尚未 setFrames,不会锚定 frameStartRound,待首个 DATA poll 才锚定。
      D.log("BTIPC: r=" + st.r + " seq=-1 len=-1 dt=" + dt + " BUSY");
      try {
        $.Schedule(BTIPC_BUSY_BACKOFF_MS / 1000, function () {
          if (D.State.btipcActive !== st) return;
          btipcShot(st);
        });
      } catch (e) { btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + D.expErr(e) }); }
      return;
    }

    // 数据帧:按 seq 入账(重复幂等),END 验收 0..max 连续
    if (!st.parts[d.seq]) st.parts[d.seq] = d.payload;
    D.log("BTIPC: r=" + st.r + " seq=" + d.seq + " len=" + d.len + " dt=" + dt + (d.end ? " END" : " OK"));
    if (!d.end) { st.r += 1; btipcShot(st); return; }

    let maxSeq = -1;
    for (const k in st.parts) { const n = parseInt(k, 10); if (!isNaN(n) && n > maxSeq) maxSeq = n; }
    const concat = [];
    let gap = -1;
    for (let i = 0; i <= maxSeq; i += 1) {
      const pl = st.parts[i];
      if (!pl) { gap = i; break; }
      for (let j = 0; j < pl.length; j += 1) concat.push(pl[j]);
    }
    if (gap >= 0) {
      // 正常流不可能(帧序到达、CRC fail 不推进);真到 = 状态被打破,诚实拒绝
      D.log("BTIPC: r=" + st.r + " GAP missing=" + gap + " → crc_dead");
      btipcFinish(st, false, { kind: "crc_dead", message: "gap at seq " + gap });
      return;
    }
    const got = btipcUtf8Decode(concat);
    D.log("BTIPC: DONE win=" + st.win + " id=" + st.idHex + " frames=" + (maxSeq + 1) +
        " bytes=" + concat.length + " total=" + (D.nowMs() - st.tReq) + "ms");
    // 翻译模式下空串 = 桥端翻译失败(协议零改动:失败编为空 END 帧)。
    // 回声模式不做此判定 —— "" 是合法回声。传输层已 DONE,这里只把语义错误上报给上层。
    if (st.translate && got === "") {
      btipcFinish(st, false, { kind: "translate_error", message: "bridge returned empty translation" });
      return;
    }
    btipcFinish(st, true, got);
  }

  function btipcFinish(st, ok, value) {
    if (D.State.btipcActive !== st) return;
    D.State.btipcActive = null;
    st.roundOpen = false;
    if (ok) {
      // btipc04:任何 BTIPC 成功(翻译/健应回声)= 桥在线实证 → 状态栏置绿
      // (6726 后 nav health 永远失败,老逻辑只会显示未连通)。
      D.State.btipcLastOk = D.nowMs();
      D.State.bridgeOfflineSince = 0;
      if (!D.State.bridgeUp) {
        D.markBridgeUp();
        try { D.setBridgeStatus(D.t("bridgeOnline") + " \u00b7 " + (D.State.cfg.provider || "bing")); } catch (e) {}
      }
      try { st.resolve(value); } catch (e) { D.log("btipc: resolve THREW " + D.expErr(e)); }
    }
    else { try { st.reject(value); } catch (e) { D.log("btipc: reject THREW " + D.expErr(e)); } }
  }

  // ---- API(§7 冻结 Promise 形)----
  const BTIPC = {
    busy: function () { return !!D.State.btipcActive; },
    newWindowId: function () { return ("000000" + (D.nowMs() & 0xffffff).toString(16)).slice(-6); },
    cancel: function () {
      const st = D.State.btipcActive;
      if (!st) return;
      try { D.log("BTIPC CAN w=" + st.win); } catch (e) {}
      btipcFinish(st, false, { kind: "cancelled", message: "cancel() called" });
    },
    request: function (opts) {
      opts = opts || {};
      return new Promise(function (resolve, reject) {
        try {
          const text = String(opts.text == null ? "" : opts.text);
          const bytes = btipcUtf8Bytes(text);
          const win = String(opts.windowId == null ? "" : opts.windowId);
          if (!/^[0-9a-f]{6}$/.test(win)) {
            reject({ kind: "bad_args", message: "windowId 需 6 位小写 hex(BTIPC.newWindowId())" });
            return;
          }
          if (bytes.length > BTIPC_REQ_MAX_PAYLOAD) {
            reject({ kind: "too_long", message: "payload " + bytes.length + "B > " + BTIPC_REQ_MAX_PAYLOAD + "B" });
            return;
          }
          if (D.State.btipcActive) {
            reject({ kind: "busy", message: "已有在途传输 win=" + D.State.btipcActive.win });
            return;
          }
          const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : BTIPC_REQ_TIMEOUT_MS;
          // translate=false → REQ(回声 conformance);true → TRQ(⑥ 翻译,空 END 帧 = 失败)
          const translate = opts.translate === true;
          const id = Math.floor(Math.random() * 65536);
          const idHex = ("0000" + id.toString(16)).slice(-4);
          const crcHex = ("0000" + btipcCrc16(bytes).toString(16)).slice(-4);
          const b64 = btipcBase64(bytes);
          const st = {
            win: win, id: id, idHex: idHex, text: text, timeoutMs: timeoutMs, translate: translate,
            r: 1, roundNo: 0, fire: {}, roundOpen: false, shotAt: 0,
            frameFails: 0, consecutiveFails: 0, stormRounds: 0,
            parts: {}, tReq: D.nowMs(), resolve: resolve, reject: reject,
          };
          D.State.btipcActive = st;
          // REQ/TRQ 行(§5):桥端 tail 自 [LCT] 起解析,行头 54 + b64 后 ≤1000(J1)
          // REQ 与 TRQ 命令词等长,故 translate 不额外占用行预算。
          D.log("BTIPC " + (translate ? "TRQ" : "REQ") + " w=" + win + " id=" + idHex +
              " len=" + bytes.length + " crc=" + crcHex + " b64=" + b64);
          btipcEnsureHandler();
          try {
            // 缺陷 A 修:死线走 Date.now() 锚定的 afterRealMs。单发 $.Schedule(timeoutMs/1000)
            // 在长延时上会早触发(实测 50s 死线 21s 就到),把本该成功的 config 读打死 ——
            // 详见 afterRealMs 的注释。alive 覆盖旧的 D.State.btipcActive !== st 守卫。
            afterRealMs(timeoutMs, function () {
              D.log("BTIPC: REQ_TIMEOUT win=" + st.win + " after " + timeoutMs + "ms");
              btipcFinish(st, false, { kind: "timeout", message: "REQ_TIMEOUT " + timeoutMs + "ms" });
            }, function () { return D.State.btipcActive === st; });
            $.Schedule(BTIPC_FIRST_SHOT_DELAY_MS / 1000, function () {
              if (D.State.btipcActive !== st) return;
              btipcShot(st);
            });
          } catch (e) {
            btipcFinish(st, false, { kind: "bridge_down", message: "schedule THREW " + D.expErr(e) });
          }
        } catch (e) {
          reject({ kind: "bad_args", message: D.expErr(e) });
        }
      });
    },
  };

  // /bt6736 [n] [text]: BTIPC 回声 conformance(§12.4)—— 桥回声模式,回显必须与发送逐字节一致
  function runBtipcEcho(arg) {
    if (D.State.bitRunning || D.State.dRunning || D.State.eRunning || D.State.c5) {
      D.log("btipc6736: 探针在途,refuse(防两套 ImageLoaded 互相污染)");
      return;
    }
    if (BTIPC.busy()) { D.log("btipc6736: BTIPC busy,先等当前传输结束"); return; }
    let count = 1;
    let text = "Hello BTIPC";
    const m = /^(\d+)(?:\s+([\s\S]+))?$/.exec(String(arg || "").trim());
    if (m) {
      count = Math.max(1, Math.min(100, parseInt(m[1], 10)));
      if (m[2]) text = m[2];
    } else if (String(arg || "").trim()) {
      text = String(arg).trim();
    }
    D.log("btipc6736: START n=" + count + " text=" + JSON.stringify(text));
    let done = 0;
    let failed = 0;
    const runOne = function () {
      if (done >= count) {
        D.log("btipc6736: ALL DONE n=" + count + " ok=" + (count - failed) + " fail=" + failed);
        return;
      }
      done += 1;
      const win = BTIPC.newWindowId();
      const t0 = D.nowMs();
      BTIPC.request({ windowId: win, text: text }).then(function (got) {
        const match = got === text;
        if (!match) failed += 1;
        D.log("btipc6736: RUN " + done + "/" + count + " win=" + win +
            (match ? " ECHO_OK" : " ECHO_MISMATCH") + " dt=" + (D.nowMs() - t0) +
            " got=" + JSON.stringify(String(got).slice(0, 60)));
        try { $.Schedule(0.3, runOne); } catch (e) { D.log("btipc6736: schedule THREW " + D.expErr(e)); }
      }).catch(function (err) {
        failed += 1;
        D.log("btipc6736: RUN " + done + "/" + count + " win=" + win + " FAIL kind=" + (err && err.kind) +
            " msg=" + (err && err.message) + " dt=" + (D.nowMs() - t0));
        try { $.Schedule(1.0, runOne); } catch (e) { D.log("btipc6736: schedule THREW " + D.expErr(e)); }
      });
    };
    runOne();
  }

  // /bt6737 [text]: BTIPC 翻译 smoke(⑥)—— 验证 TRQ→BUSY→译文全链。
  // 翻译层只见 BTIPC.request() 的 Promise,不见 panel/CRC/round/frameFails。
  function runBtipcTranslate(arg) {
    if (D.State.bitRunning || D.State.dRunning || D.State.eRunning || D.State.c5) {
      D.log("btipc6737: 探针在途,refuse(防两套 ImageLoaded 互相污染)");
      return;
    }
    if (BTIPC.busy()) { D.log("btipc6737: BTIPC busy,先等当前传输结束"); return; }
    const text = String(arg || "");
    const win = BTIPC.newWindowId();
    const t0 = D.nowMs();
    D.log("btipc6737: START text=" + JSON.stringify(text.slice(0, 60)));
    BTIPC.request({ windowId: win, text: text, translate: true }).then(function (got) {
      D.log("btipc6737: OK win=" + win + " dt=" + (D.nowMs() - t0) + "ms got=" + JSON.stringify(String(got).slice(0, 80)));
    }).catch(function (err) {
      D.log("btipc6737: FAIL win=" + win + " kind=" + (err && err.kind) +
          " msg=" + (err && err.message) + " dt=" + (D.nowMs() - t0) + "ms");
    });
  }

  // ---- 宿主依赖注入(主文件 boot() 首行调用;必须先于任何 BTIPC.* 调用)----
  function init(deps) { D = deps; }

  return {
    init: init,
    afterRealMs: afterRealMs, btipcCrc16: btipcCrc16, btipcDecodeFrame: btipcDecodeFrame,
    btipcUtf8Decode: btipcUtf8Decode, btipcUtf8Bytes: btipcUtf8Bytes, btipcBase64: btipcBase64,
    btipcPanels: btipcPanels, btipcEnsureHandler: btipcEnsureHandler, btipcShot: btipcShot,
    btipcClose: btipcClose, btipcFinish: btipcFinish,
    BTIPC: BTIPC, runBtipcEcho: runBtipcEcho, runBtipcTranslate: runBtipcTranslate,
    // 主文件另有 4 个常量在传输层之外被引用(写死线/行预算/拥塞豁免窗),一处定义两处用
    BTIPC_T_CLOSE_MS: BTIPC_T_CLOSE_MS, BTIPC_FIRST_SHOT_DELAY_MS: BTIPC_FIRST_SHOT_DELAY_MS,
    BTIPC_REQ_MAX_PAYLOAD: BTIPC_REQ_MAX_PAYLOAD, BTIPC_ECHO_STORM_WINDOW_MS: BTIPC_ECHO_STORM_WINDOW_MS,
  };
})();
// Panorama 内跨 script 共享全局;显式挂 globalThis 同时兼容 node require(simtest)
globalThis.LCTBTIPC = LCTBTIPC;
