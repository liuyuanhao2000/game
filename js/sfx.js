// 军旗翻翻棋 — 音效（Web Audio 程序化合成，零资源文件）
// 懒创建 AudioContext（满足浏览器自动播放策略：首次用户交互后才出声）；
// 无 AudioContext 的环境（node 测试/DOM 桩）下 play 静默 no-op。
// 音色设计：ADSR 指数包络 + 滤波噪声 + 非旋律音效 ±3% 音高抖动（避免机械感）；
// 胜负小调用五声音阶（宫商角徵羽），胜利配合成锣声。
;(function () {
  const NS = (typeof window !== 'undefined') ? window : globalThis;
  NS.Junqi = NS.Junqi || {};

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  try { muted = (typeof localStorage !== 'undefined') && localStorage.getItem('junqi-sfx-muted') === '1'; } catch (e) { /* file:// 个别浏览器禁用 localStorage */ }

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }
    const AC = (typeof AudioContext !== 'undefined') ? AudioContext
      : (typeof webkitAudioContext !== 'undefined') ? webkitAudioContext : null;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 预生成 1s 白噪声（所有噪声类音效共用）
    const len = Math.max(1, Math.floor(ctx.sampleRate));
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  // ---- 合成基元 ----
  // tone：振荡器 + 指数包络；slide 为结束频率（指数滑音）
  function tone(freq, o) {
    o = o || {};
    const t0 = o.t0 != null ? o.t0 : ctx.currentTime;
    const dur = o.dur || 0.1;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t0 + dur);
    const atk = o.attack || 0.005;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain != null ? o.gain : 0.3, t0 + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  // noiseHit：白噪声 + 双二阶滤波 + 包络
  function noiseHit(o) {
    o = o || {};
    const t0 = o.t0 != null ? o.t0 : ctx.currentTime;
    const dur = o.dur || 0.08;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.filter || 'bandpass';
    filt.frequency.setValueAtTime(Math.max(30, o.freq || 1000), t0);
    if (o.slide) filt.frequency.exponentialRampToValueAtTime(Math.max(30, o.slide), t0 + dur);
    filt.Q.value = o.Q != null ? o.Q : 1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(o.gain != null ? o.gain : 0.4, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(env);
    env.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  // 非旋律音高音高抖动 ±3%
  const jit = (f) => f * (0.97 + Math.random() * 0.06);

  // ---- 五声音阶（宫商角徵羽）与锣 ----
  const P = { D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00, C6: 1046.50 };
  function pluck(freq, t0) { // 拨弦感：三角波基频 + 短八度泛音
    tone(freq, { type: 'triangle', t0, dur: 0.34, gain: 0.24, attack: 0.004 });
    tone(freq * 2, { type: 'sine', t0, dur: 0.12, gain: 0.06, attack: 0.002 });
  }
  function gong(t0, bright) { // 锣：失谐正弦簇 + 长衰减 + 击打噪声
    const base = bright ? 196.0 : 130.8;
    const parts = [1, 1.503, 2.01, 2.67];
    for (let i = 0; i < parts.length; i++) {
      tone(base * parts[i], { type: 'sine', t0, dur: 1.5 - i * 0.25, gain: 0.13 / (i + 1), attack: 0.004 });
    }
    noiseHit({ t0, dur: 0.09, filter: 'lowpass', freq: 2400, gain: 0.09 });
  }

  // ---- 音效表 ----
  const SOUNDS = {
    select() { tone(jit(1250), { dur: 0.05, gain: 0.11 }); },

    flip() {
      noiseHit({ dur: 0.03, filter: 'highpass', freq: 2500, gain: 0.2 });
      tone(jit(300), { type: 'triangle', dur: 0.11, gain: 0.18, slide: 620 });
    },

    move() { // 木质感落子：带通噪声"咔" + 低频衬底
      noiseHit({ dur: 0.06, filter: 'bandpass', freq: jit(820), Q: 3.5, gain: 0.5 });
      tone(jit(185), { dur: 0.09, gain: 0.15, slide: 140 });
    },

    capture() { // 吃子：噪声爆发 + 下冲锯齿
      noiseHit({ dur: 0.11, filter: 'lowpass', freq: 1500, slide: 320, gain: 0.5 });
      tone(jit(230), { type: 'sawtooth', dur: 0.16, gain: 0.14, slide: 110 });
    },

    die() { // 己子阵亡：闷响下行
      tone(jit(120), { dur: 0.22, gain: 0.28, slide: 66 });
      noiseHit({ dur: 0.08, filter: 'lowpass', freq: 420, gain: 0.2 });
    },

    both() { // 同归于尽：两记错开 70ms 的撞击
      const t = ctx.currentTime;
      noiseHit({ t0: t, dur: 0.09, filter: 'lowpass', freq: 1300, slide: 300, gain: 0.45 });
      tone(jit(210), { type: 'sawtooth', t0: t, dur: 0.13, gain: 0.13, slide: 100 });
      noiseHit({ t0: t + 0.07, dur: 0.09, filter: 'lowpass', freq: 900, slide: 220, gain: 0.38 });
      tone(jit(160), { type: 'sawtooth', t0: t + 0.07, dur: 0.12, gain: 0.11, slide: 80 });
    },

    bomb() { // 炸弹引爆：长轰鸣噪声扫频 + 次低音下坠 + 起爆"啪"
      const t = ctx.currentTime;
      noiseHit({ t0: t, dur: 0.5, filter: 'lowpass', freq: 1300, slide: 90, gain: 0.75 });
      tone(92, { t0: t, dur: 0.45, gain: 0.45, slide: 30 });
      tone(1800, { type: 'square', t0: t, dur: 0.04, gain: 0.07, slide: 300 });
    },

    mine() { // 工兵拔雷：金属"叮"（两枚失谐方波 + 高频击打）
      const t = ctx.currentTime;
      tone(jit(1420), { type: 'square', t0: t, dur: 0.09, gain: 0.09 });
      tone(jit(2130), { type: 'square', t0: t + 0.02, dur: 0.14, gain: 0.07 });
      noiseHit({ t0: t, dur: 0.05, filter: 'highpass', freq: 3000, gain: 0.11 });
    },

    invalid() { // 非法操作：低频双响（配格子闪红）
      const t = ctx.currentTime;
      tone(150, { type: 'square', t0: t, dur: 0.07, gain: 0.11 });
      tone(150, { type: 'square', t0: t + 0.1, dur: 0.07, gain: 0.09 });
    },

    win() { // 胜利：五声音阶上行 + 亮锣
      const t = ctx.currentTime;
      const seq = [P.C5, P.D5, P.E5, P.G5, P.A5, P.C6];
      for (let i = 0; i < seq.length; i++) pluck(seq[i], t + i * 0.11);
      gong(t + 0.68, true);
    },

    lose() { // 失败：五声音阶下行短句 + 暗锣
      const t = ctx.currentTime;
      const seq = [P.A4, P.G4, P.E4, P.D4];
      for (let i = 0; i < seq.length; i++) pluck(seq[i], t + i * 0.16);
      gong(t + 0.66, false);
    },

    draw() { // 和局：中性双音
      const t = ctx.currentTime;
      pluck(P.G4, t);
      pluck(P.C5, t + 0.18);
    },
  };

  function play(name) {
    if (muted) return;
    if (!ensureCtx()) return;
    const fn = SOUNDS[name];
    if (fn) fn();
  }

  // ---- 棋局事件 → 音效名（纯函数，可单测）----
  function soundFor(lastMove) {
    if (!lastMove) return null;
    if (lastMove.kind === 'flip') return 'flip';
    if (!lastMove.battle) return 'move';
    const b = lastMove.battle;
    if (lastMove.type === 'bomb' || b.type === 'bomb') return 'bomb'; // 炸弹引爆（含炸旗）
    if (b.type === 'mine') return b.outcome === 'win' ? 'mine' : 'die'; // 工兵挖雷 vs 撞雷
    if (b.outcome === 'win' || b.outcome === 'flag') return 'capture';
    if (b.outcome === 'lose') return 'die';
    if (b.outcome === 'both') return 'both';
    return 'move';
  }

  // ---- 静音（localStorage 持久化）----
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('junqi-sfx-muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }
  function isMuted() { return muted; }
  function toggleMuted() { setMuted(!muted); return muted; }

  NS.Junqi.sfx = { play, soundFor, setMuted, isMuted, toggleMuted };
})();
