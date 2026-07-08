(function () {
  "use strict";
  const CREATURES = window.CREATURES || [];
  const MAP = window.MAP || { start: "start", nodes: [], edges: [] };
  const STORAGE_KEY = "shanjing_state_v1";
  const SOUND_KEY = "shanjing_sound_v1";

  const $ = (s) => document.querySelector(s);
  const creatureById = (id) => CREATURES.find((c) => c.id === id);
  const nodeById = (id) => MAP.nodes.find((n) => n.id === id);
  // 路线按无向图处理：既能继续向前探索，也能原路返回、前往其他到过之地
  const neighbors = (id) => {
    const out = MAP.edges.filter((e) => e.from === id).map((e) => e.to);
    const inc = MAP.edges.filter((e) => e.to === id).map((e) => e.from);
    return [...new Set([...out, ...inc])];
  };

  // ---------- 状态 ----------
  let state = loadState();
  let soundOn = localStorage.getItem(SOUND_KEY) !== "off";

  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && s.discovered) return s;
    } catch (e) {}
    return { current: MAP.start, discovered: {}, visited: { [MAP.start]: true } };
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- 音频（WebAudio 合成，无需素材文件） ----------
  let audioCtx;
  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function tone(freq, dur, type, gain, when) {
    if (!soundOn) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + (when || 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.14, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  function sfxClick() {
    tone(620, 0.12, "triangle", 0.12);
  }
  function sfxDiscover() {
    // 五声音阶 宫商角徵羽
    const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
    notes.forEach((f, i) => tone(f, 0.5, "sine", 0.16, i * 0.12));
  }

  // ---------- 图片（带占位回退） ----------
  function makeImg(src, ph) {
    const img = document.createElement("img");
    img.className = "card-img";
    img.alt = "";
    img.onerror = () => {
      const d = document.createElement("div");
      d.className = "card-img placeholder";
      d.textContent = ph;
      img.replaceWith(d);
    };
    img.src = src;
    return img;
  }
  function makeThumb(src, ph) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.onerror = () => {
      const d = document.createElement("div");
      d.className = "thumb placeholder";
      d.textContent = ph;
      img.replaceWith(d);
    };
    img.src = src;
    return img;
  }

  // ---------- 路线（已探索路径） ----------
  function pathTo(from, to) {
    const q = [[from]];
    const seen = new Set([from]);
    while (q.length) {
      const p = q.shift();
      const last = p[p.length - 1];
      if (last === to) return p;
      neighbors(last).forEach((nx) => {
        if (!seen.has(nx)) {
          seen.add(nx);
          q.push(p.concat(nx));
        }
      });
    }
    return [from];
  }
  function addLine(a, b, dashed) {
    if (!a || !b) return;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
    line.setAttribute("stroke", dashed ? "#e8c87a" : "rgba(200,164,92,0.5)");
    line.setAttribute("stroke-width", "0.5");
    if (dashed) line.setAttribute("stroke-dasharray", "2 2");
    line.setAttribute("opacity", "0.7");
    $("#map-lines").appendChild(line);
  }

  // ---------- 地图视图：全屏缩放 / 拖动 ----------
  const stage = $("#map-stage");
  const viewport = $("#map-viewport");
  let scale = 1, tx = 0, ty = 0, baseDim = 0;
  const MIN_SCALE = 0.6, MAX_SCALE = 6, OVER = 160;
  const pointers = new Map();
  let last = { x: 0, y: 0 };
  let pinchDist = 0, pinchMid = null;
  let dragMoved = false;
  let clickSuppressed = false;

  function stageRect() { return stage.getBoundingClientRect(); }
  function applyTransform() {
    viewport.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
  }
  function sizeWorld() {
    const r = stageRect();
    // 世界 = 完整方形图，取屏幕长边，使图完整显示且大于屏幕，可拖动看溢出部分
    baseDim = Math.max(r.width, r.height);
    viewport.style.width = baseDim + "px";
    viewport.style.height = baseDim + "px";
  }
  function clampPan() {
    const r = stageRect();
    const w = baseDim * scale, h = baseDim * scale;
    const minTx = Math.min(0, r.width - w) - OVER;
    const maxTx = Math.max(0, r.width - w) + OVER;
    const minTy = Math.min(0, r.height - h) - OVER;
    const maxTy = Math.max(0, r.height - h) + OVER;
    tx = Math.max(minTx, Math.min(maxTx, tx));
    ty = Math.max(minTy, Math.min(maxTy, ty));
  }
  function fit() {
    const r = stageRect();
    scale = 1;
    tx = (r.width - baseDim) / 2;
    ty = (r.height - baseDim) / 2;
    applyTransform();
  }
  function zoomAt(cx, cy, factor) {
    const wx = (cx - tx) / scale;
    const wy = (cy - ty) / scale;
    let ns = factor * scale;
    ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, ns));
    scale = ns;
    tx = cx - wx * scale;
    ty = cy - wy * scale;
    clampPan();
    applyTransform();
  }
  function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid2(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  function setupMapView() {
    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".map-controls")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      clickSuppressed = false;
      dragMoved = false;
      if (pointers.size === 1) {
        last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        const p = [...pointers.values()];
        pinchDist = dist2(p[0], p[1]);
        pinchMid = mid2(p[0], p[1]);
      }
      stage.classList.add("grabbing");
    });
    window.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = stageRect();
      if (pointers.size === 1) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
        if (dragMoved) {
          clickSuppressed = true;
          tx += dx; ty += dy;
          applyTransform();
        }
        last = { x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        const p = [...pointers.values()];
        const d = dist2(p[0], p[1]);
        const m = mid2(p[0], p[1]);
        const cx = m.x - r.left, cy = m.y - r.top;
        const factor = pinchDist > 0 ? d / pinchDist : 1;
        const wx = (cx - tx) / scale, wy = (cy - ty) / scale;
        let ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
        scale = ns;
        tx = cx - wx * scale; ty = cy - wy * scale;
        if (pinchMid) { tx += m.x - pinchMid.x; ty += m.y - pinchMid.y; }
        pinchDist = d; pinchMid = m;
        dragMoved = true; clickSuppressed = true;
        clampPan(); applyTransform();
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) { pinchDist = 0; pinchMid = null; }
      if (pointers.size === 0) stage.classList.remove("grabbing");
    };
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = stageRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      zoomAt(cx, cy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    $("#zoom-in").onclick = () => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, 1.3); };
    $("#zoom-out").onclick = () => { const r = stageRect(); zoomAt(r.width / 2, r.height / 2, 1 / 1.3); };
    $("#zoom-reset").onclick = () => fit();

    window.addEventListener("resize", () => { sizeWorld(); clampPan(); fit(); });
  }

  // ---------- 渲染地图 ----------
  function renderMap() {
    $("#map-bg").style.backgroundImage = "url('assets/images/map-bg.svg')";
    const nodesLayer = $("#nodes");
    nodesLayer.innerHTML = "";
    $("#map-lines").innerHTML = "";
    const reachable = neighbors(state.current);

    MAP.nodes.forEach((n) => {
      const isPlayer = n.id === state.current;
      const isReachable = reachable.includes(n.id);
      const isVisited = !!state.visited[n.id];
      const isFound = n.type === "creature" && state.discovered[n.id];
      // 未解锁、不可达且未曾到访过的妖兽：保持隐藏（保留探索感）
      if (n.type === "creature" && !isFound && !isReachable && !isVisited) return;

      const el = document.createElement("div");
      let cls = "node";
      if (isPlayer) cls += " player";
      else if (isReachable) cls += " reachable";
      else if (isVisited || isFound) cls += " found";
      el.className = cls;
      el.style.left = n.x + "%";
      el.style.top = n.y + "%";
      let label = "";
      if (isPlayer) label = n.label + "（你）";
      else if (isReachable) label = n.label;
      else if (isVisited || isFound) label = n.label;
      el.innerHTML =
        '<div class="node-dot"></div>' + (label ? '<div class="node-label">' + label + "</div>" : "");

      // 可达（继续探索 / 原路返回）或曾到访过（一键跳回 / 前往其他到过之地）均可点击移动
      if (isReachable || isVisited) {
        el.addEventListener("click", () => {
          if (clickSuppressed) return;
          sfxClick();
          travel(n.id);
        });
      }
      nodesLayer.appendChild(el);

      if (isReachable) addLine(nodeById(state.current), n, true);
    });

    // 已探索路径
    const path = pathTo(MAP.start, state.current);
    for (let i = 0; i < path.length - 1; i++) addLine(nodeById(path[i]), nodeById(path[i + 1]), false);
  }

  // ---------- 旅程 ----------
  function travel(toId) {
    const node = nodeById(toId);
    state.current = toId;
    state.visited[toId] = true;
    const isCreature = node.type === "creature";
    const already = isCreature && state.discovered[toId];
    saveState();
    updateProgress();

    if (isCreature && !already) {
      showClue(creatureById(toId));
    } else {
      renderMap();
      if (already) {
        const c = creatureById(toId);
        showToast("再临 " + c.name + " 之地");
        setTimeout(() => openCard(toId), 600);
      } else {
        setHint("你来到 " + node.label + "。环顾四周，似有妖气隐现。");
      }
    }
  }

  function showClue(c) {
    $("#clue-text").textContent = c.clue;
    $("#clue-overlay").classList.add("show");
    $("#clue-next").onclick = () => {
      sfxClick();
      $("#clue-overlay").classList.remove("show");
      showVillager(c);
    };
  }
  function showVillager(c) {
    $("#villager-text").textContent = c.villager;
    $("#villager-overlay").classList.add("show");
    $("#villager-go").onclick = () => {
      sfxClick();
      $("#villager-overlay").classList.remove("show");
      discover(c);
    };
  }
  function discover(c) {
    state.discovered[c.id] = true;
    saveState();
    updateProgress();
    sfxDiscover();
    showToast("✦ 发现妖兽 · " + c.name + " ✦");
    renderMap();
    setTimeout(() => openCard(c.id), 900);
  }

  // ---------- 卡片 ----------
  function openCard(id) {
    const c = creatureById(id);
    $("#card-name").textContent = c.name;
    $("#card-alias").textContent = "别名：" + c.alias;
    $("#card-region").textContent = c.region + "方";
    $("#card-source").textContent = c.source;
    $("#card-vernacular").textContent = c.vernacular;
    $("#card-original").textContent = c.original;
    const wrap = $(".card-img-wrap");
    wrap.innerHTML = "";
    wrap.appendChild(makeImg("assets/images/creatures/" + id + ".png", c.name.charAt(0)));
    $("#card-overlay").classList.add("show");
  }

  // ---------- 图鉴 ----------
  function renderCodex() {
    const grid = $("#codex-grid");
    grid.innerHTML = "";
    CREATURES.forEach((c) => {
      const found = state.discovered[c.id];
      const cell = document.createElement("div");
      cell.className = "codex-cell" + (found ? "" : " locked");
      if (found) {
        cell.appendChild(makeThumb("assets/images/creatures/" + c.id + ".png", c.name.charAt(0)));
        const cap = document.createElement("div");
        cap.className = "cap";
        cap.textContent = c.name;
        cell.appendChild(cap);
        cell.addEventListener("click", () => {
          sfxClick();
          openCard(c.id);
        });
      } else {
        const thumb = document.createElement("div");
        thumb.className = "thumb placeholder";
        thumb.textContent = "？";
        cell.appendChild(thumb);
        const cap = document.createElement("div");
        cap.className = "cap";
        cap.textContent = "未寻得";
        cell.appendChild(cap);
      }
      grid.appendChild(cell);
    });
    $("#codex-count").textContent = Object.keys(state.discovered).length + "/" + CREATURES.length;
  }

  // ---------- 进度 / 提示 ----------
  function updateProgress() {
    const n = Object.keys(state.discovered).length;
    $("#progress").textContent = "已得 " + n + " / " + CREATURES.length;
    if (n === CREATURES.length) setHint("十方妖兽皆入图鉴，游历圆满。");
  }
  function setHint(t) {
    $("#hint").textContent = t;
  }
  let toastTimer;
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- 初始化 ----------
  function init() {
    updateProgress();
    sizeWorld();
    fit();
    setupMapView();
    renderMap();

    $("#open-codex").onclick = () => {
      sfxClick();
      renderCodex();
      $("#codex-overlay").classList.add("show");
    };
    $("#codex-close").onclick = () => $("#codex-overlay").classList.remove("show");
    $("#open-settings").onclick = () => {
      sfxClick();
      syncSoundToggle();
      $("#settings-overlay").classList.add("show");
    };
    $("#settings-close").onclick = () => $("#settings-overlay").classList.remove("show");
    $("#card-close").onclick = () => $("#card-overlay").classList.remove("show");

    $("#toggle-sound").onclick = () => {
      soundOn = !soundOn;
      localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
      if (soundOn) {
        ensureAudio();
        sfxClick();
      }
      syncSoundToggle();
    };
    $("#reset-progress").onclick = () => {
      if (confirm("确定重置所有游历进度？已得妖兽卡片将清空。")) {
        state = { current: MAP.start, discovered: {}, visited: { [MAP.start]: true } };
        saveState();
        updateProgress();
        renderMap();
        setHint("游历重置，你重返昆仑·中土。");
        $("#settings-overlay").classList.remove("show");
      }
    };

    ["#card-overlay", "#codex-overlay", "#settings-overlay"].forEach((s) => {
      $(s).addEventListener("click", (e) => {
        if (e.target === $(s)) $(s).classList.remove("show");
      });
    });
  }
  function syncSoundToggle() {
    const b = $("#toggle-sound");
    b.textContent = soundOn ? "开" : "关";
    b.classList.toggle("off", !soundOn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
