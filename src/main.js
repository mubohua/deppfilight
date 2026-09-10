import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildAircraft } from './aircraft.js';
import { PALETTE, AIRCRAFT, SURF_SIGN } from './config.js';

const MAX_FILES = 8; // 单次最多对比的文件数（每个文件内存占用较大）

// ---------- 场景 ----------
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e17);

const camera = new THREE.PerspectiveCamera(55, view.clientWidth / view.clientHeight, 1, 500000);
camera.position.set(6000, 5000, 6000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.499; // 不穿到地面下

scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a2030, 1.1));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(0.5, 1, 0.3).multiplyScalar(10000);
scene.add(dir);

// 地面（AGL=0 平面）
const groundGroup = new THREE.Group();
scene.add(groundGroup);
let grid = null;
const groundMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 1, metalness: 0 });
const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = -0.05;
groundGroup.add(groundPlane);

// ---------- 状态 ----------
const trajectories = [];
let maxDuration = 1;
let progress = 0;          // 0..1
let playing = false;
let lastTime = 0;
let currentSpeed = 1;

// ---------- 加载 ----------
const fileInput = document.getElementById('fileInput');
const fileListEl = document.getElementById('fileList');
const hudEl = document.getElementById('hud');
const loadingEl = document.getElementById('loading');
const timeline = document.getElementById('timeline');
const playBtn = document.getElementById('playBtn');
const speedSel = document.getElementById('speedSel');
const resetBtn = document.getElementById('resetBtn');
const scaleRange = document.getElementById('scaleRange');
const scaleVal = document.getElementById('scaleVal');
const vertRange = document.getElementById('vertRange');
const vertVal = document.getElementById('vertVal');
const followBtn = document.getElementById('followBtn');
const followSel = document.getElementById('followSel');

let modelScale = Number(scaleRange.value);
let scaleInited = false;

let vertScale = Number(vertRange.value);
let vertInited = false;

// 追尾镜头
let followEnabled = false;
let followTraj = null;
let _hasChase = false;
let _lastFrame = 0;
let chaseDistFactor = 1.4; // 追尾距离 = 翼展显示尺寸 × 该系数（滚轮可调）
const _desired = new THREE.Vector3();

scaleRange.addEventListener('input', () => {
  modelScale = Number(scaleRange.value);
  scaleVal.textContent = modelScale + '×';
  for (const tr of trajectories) tr.model.scale.setScalar(modelScale);
  apply(progress);
});

vertRange.addEventListener('input', () => {
  vertScale = Number(vertRange.value);
  vertVal.textContent = vertScale + '×';
  applyVertScale();
  apply(progress);
});

function applyVertScale() {
  for (const tr of trajectories) tr.line.scale.y = vertScale;
}

followBtn.addEventListener('click', () => {
  followEnabled = !followEnabled;
  followBtn.classList.toggle('on', followEnabled);
  followBtn.textContent = followEnabled ? '追尾中' : '跟随';
  controls.enabled = !followEnabled;
  if (followEnabled) {
    if (!followTraj || !trajectories.includes(followTraj)) {
      followTraj = trajectories.find((t) => t.visible) || trajectories[0] || null;
    }
    if (followTraj) {
      followSel.value = String(trajectories.indexOf(followTraj));
      snapChase();
    }
  }
});

followSel.addEventListener('change', () => {
  const idx = Number(followSel.value);
  if (trajectories[idx]) {
    followTraj = trajectories[idx];
    if (followEnabled) snapChase();
  }
});

// 稳定式追尾：只按航向把相机放在飞机正后方（忽略滚转），地平线保持水平
const _RAD = Math.PI / 180;

function chaseDesired(out) {
  const tr = followTraj;
  const p = tr.model.position;
  const d = tr.data;
  const i = findIndex(d.pt, progress * tr.duration);
  const yaw = d.yaw[i]; // 已含 YAW_SIGN，弧度
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const wing = AIRCRAFT.wing.span * modelScale;
  const dist = wing * chaseDistFactor;
  const h = dist * 0.3;
  out.set(p.x - fx * dist, p.y + h, p.z - fz * dist);
}

// 追尾时滚轮调整远近
renderer.domElement.addEventListener('wheel', (e) => {
  if (!followEnabled) return;
  e.preventDefault();
  chaseDistFactor = Math.min(6, Math.max(0.5, chaseDistFactor + Math.sign(e.deltaY) * 0.1));
}, { passive: false });

function snapChase() {
  if (!followTraj) return;
  chaseDesired(_desired);
  camera.position.copy(_desired);
  controls.target.copy(followTraj.model.position);
  camera.lookAt(controls.target);
  _hasChase = true;
}

function updateChase(dt) {
  if (!followEnabled || !followTraj || !followTraj.visible) return;
  chaseDesired(_desired);
  const a = _hasChase ? 1 - Math.exp(-6 * dt) : 1;
  camera.position.lerp(_desired, a);
  controls.target.copy(followTraj.model.position);
  camera.lookAt(controls.target);
  _hasChase = true;
}

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

// 拖拽
view.addEventListener('dragover', (e) => { e.preventDefault(); });
view.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
});

function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith('.csv'));
  if (!files.length) return;
  if (trajectories.length + files.length > MAX_FILES) {
    alert(`单次最多加载 ${MAX_FILES} 个文件用于对比，请减少选择。`);
  }
  const room = Math.max(0, MAX_FILES - trajectories.length);
  files.slice(0, room).forEach((file, i) => {
    const color = PALETTE[(trajectories.length + i) % PALETTE.length];
    loadOne(file, color);
  });
}

function loadOne(file, color) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.innerHTML = `<span class="dot" style="background:#${color.toString(16).padStart(6, '0')}"></span>
    <span class="fname">${escapeHtml(file.name)}</span>
    <span class="fstat">读取中…</span>`;
  fileListEl.appendChild(item);
  const statEl = item.querySelector('.fstat');

  const worker = new Worker('src/csvWorker.js');
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') {
      statEl.textContent = `${Math.round((m.loaded / m.total) * 100)}%`;
    } else if (m.type === 'done') {
      statEl.textContent = `✓ ${m.meta.count}点`;
      addTrajectory(file.name, color, m, item);
      worker.terminate();
    } else if (m.type === 'error') {
      statEl.textContent = '✗ 失败';
      console.error(m.message);
      worker.terminate();
    }
  };
  worker.onerror = (err) => {
    statEl.textContent = '✗ 解析器错误';
    console.error(err.message || err);
  };
  file.arrayBuffer().then((buf) => {
    worker.postMessage({ type: 'parse', buffer: buf, eps: 0.5 }, [buf]);
  }).catch((err) => { statEl.textContent = '✗ 读取失败'; console.error(err); });
}

function addTrajectory(name, color, data, item) {
  const { px, py, pz, pt, quat, gs, ias, alt, roll, pitch, yaw, phase, meta } = data;
  const n = meta.count;

  // 轨迹线
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = px[i];
    pos[i * 3 + 1] = py[i];
    pos[i * 3 + 2] = pz[i];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  line.frustumCulled = false;
  scene.add(line);

  // 飞机
  const model = buildAircraft();

  const span = Math.max(meta.bounds.maxX - meta.bounds.minX, meta.bounds.maxZ - meta.bounds.minZ, 200);

  // 首次加载时按场景跨度自动定一个可见的放大系数
  if (!scaleInited) {
    modelScale = Math.round(Math.min(400, Math.max(1, span / 100)));
    scaleRange.value = String(modelScale);
    scaleVal.textContent = modelScale + '×';
    scaleInited = true;
  }
  model.scale.setScalar(modelScale);

  // 首次加载时自动取一个能让高度可见的垂直放大
  if (!vertInited) {
    const maxY = Math.max(meta.bounds.maxY, 1);
    const k = Math.round(((span / 10) / maxY) * 2) / 2;
    vertScale = Math.min(20, Math.max(1, k));
    vertRange.value = String(vertScale);
    vertVal.textContent = vertScale + '×';
    vertInited = true;
  }
  line.scale.y = vertScale;

  model.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      const base = new THREE.Color(color);
      const isCtrl = o.parent && o.parent.userData && o.parent.userData.axis;
      if (isCtrl) base.multiplyScalar(0.55); // 舵面暗一档，便于看清偏转
      o.material.color.copy(base);
      o.material.emissive = new THREE.Color(color).multiplyScalar(0.12);
    }
  });
  scene.add(model);

  const traj = {
    name, color, meta, data, line, model,
    surfaces: model.userData.surfaces,
    duration: meta.duration,
    visible: true,
  };
  trajectories.push(traj);
  maxDuration = Math.max(maxDuration, meta.duration);

  const opt = document.createElement('option');
  opt.value = String(trajectories.length - 1);
  opt.textContent = `${trajectories.length - 1 + 1}. ${name}`;
  followSel.appendChild(opt);
  if (!followTraj) followTraj = traj;

  updateGroundAndFit();
  updateTimelineMax();
  apply(progress);

  // 文件列表交互
  if (item) {
    item.title = `${name}\n点数 ${n} / 原始 ${meta.rawCount}，接地裁剪 ${meta.removedAfterTouchdown} 行`;
    item.addEventListener('click', () => toggleTrajectory(traj, item));
    item.classList.add('on');
  }
}

function toggleTrajectory(traj, item) {
  traj.visible = !traj.visible;
  traj.line.visible = traj.visible;
  traj.model.visible = traj.visible;
  item.classList.toggle('on', traj.visible);
}

// ---------- 地面与视野 ----------
function overallBounds() {
  let b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const tr of trajectories) {
    const m = tr.meta.bounds;
    b.minX = Math.min(b.minX, m.minX); b.maxX = Math.max(b.maxX, m.maxX);
    b.minY = Math.min(b.minY, m.minY); b.maxY = Math.max(b.maxY, m.maxY);
    b.minZ = Math.min(b.minZ, m.minZ); b.maxZ = Math.max(b.maxZ, m.maxZ);
  }
  return b;
}

function updateGroundAndFit() {
  const b = overallBounds();
  if (!isFinite(b.minX)) return;
  const spanX = b.maxX - b.minX, spanZ = b.maxZ - b.minZ;
  const size = Math.max(spanX, spanZ, 500) * 1.6;
  groundPlane.scale.set(size, size, 1);
  if (grid) groundGroup.remove(grid);
  grid = new THREE.GridHelper(size, 40, 0x2a3550, 0x1a2233);
  grid.position.y = 0;
  groundGroup.add(grid);
}

function fitView() {
  const b = overallBounds();
  if (!isFinite(b.minX)) return;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const cy = ((b.minY + b.maxY) / 2) * vertScale;
  const span = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * vertScale, b.maxZ - b.minZ, 500);
  const dist = span * 1.8;
  camera.position.set(cx + dist * 0.7, cy + dist * 0.75, cz + dist * 0.7);
  controls.target.set(cx, cy * 0.6, cz);
  camera.near = Math.max(0.5, span / 5000);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

resetBtn.addEventListener('click', () => {
  followEnabled = false;
  followBtn.classList.remove('on');
  followBtn.textContent = '跟随';
  controls.enabled = true;
  _hasChase = false;
  fitView();
});

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
    e.preventDefault();
    playBtn.click();
  }
});

// ---------- 时间轴 ----------
function updateTimelineMax() {
  // 时间轴统一用 0..1 归一化进度
  timeline.value = String(Math.round(progress * 1000));
}

timeline.addEventListener('input', () => {
  progress = Number(timeline.value) / 1000;
  apply(progress);
});

playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  if (playing) {
    if (progress >= 1) progress = 0;
    lastTime = performance.now();
    requestAnimationFrame(tick);
  }
});

speedSel.addEventListener('change', () => { currentSpeed = Number(speedSel.value); });

function tick(now) {
  if (!playing) return;
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  const secs = maxDuration / 1000;
  progress += (dt * currentSpeed) / secs;
  if (progress >= 1) { progress = 1; playing = false; playBtn.textContent = '▶ 播放'; }
  timeline.value = String(Math.round(progress * 1000));
  apply(progress);
  if (playing) requestAnimationFrame(tick);
}

// ---------- 采样与更新 ----------
function findIndex(pt, ms) {
  let lo = 0, hi = pt.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pt[mid] <= ms) lo = mid; else hi = mid - 1;
  }
  return lo;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

function apply(p) {
  for (const tr of trajectories) {
    if (!tr.visible) continue;
    const d = tr.data;
    const n = d.meta.count;
    const localMs = p * tr.duration;
    const i0 = findIndex(d.pt, localMs);
    const i1 = Math.min(i0 + 1, n - 1);
    const t0 = d.pt[i0], t1 = d.pt[i1];
    const f = t1 > t0 ? (localMs - t0) / (t1 - t0) : 0;

    _p.set(
      lerp(d.px[i0], d.px[i1], f),
      lerp(d.py[i0], d.py[i1], f) * vertScale + AIRCRAFT.groundOffset * modelScale,
      lerp(d.pz[i0], d.pz[i1], f)
    );
    tr.model.position.copy(_p);

    _q1.set(d.quat[i0 * 4], d.quat[i0 * 4 + 1], d.quat[i0 * 4 + 2], d.quat[i0 * 4 + 3]);
    _q2.set(d.quat[i1 * 4], d.quat[i1 * 4 + 1], d.quat[i1 * 4 + 2], d.quat[i1 * 4 + 3]);
    _q.copy(_q1).slerp(_q2, f);
    tr.model.quaternion.copy(_q);

    applySurfaces(tr, i0, i1, f);
  }
  updateHud();
}

function applySurfaces(tr, i0, i1, f) {
  const d = tr.data, s = tr.surfaces;
  if (!s) return;
  const deg = (arr) => lerp(arr[i0], arr[i1], f) * _RAD;
  s.aileronL.rotation.x = deg(d.ailL) * SURF_SIGN.aileronL;
  s.aileronR.rotation.x = deg(d.ailR) * SURF_SIGN.aileronR;
  s.flaperonL.rotation.x = deg(d.flaL) * SURF_SIGN.flaperonL;
  s.flaperonR.rotation.x = deg(d.flaR) * SURF_SIGN.flaperonR;
  const flat = deg(d.flap);
  s.flapL.rotation.x = flat * SURF_SIGN.flap;
  s.flapR.rotation.x = flat * SURF_SIGN.flap;
  s.elevator.rotation.x = deg(d.elev) * SURF_SIGN.elevator;
  s.rudder.rotation.y = deg(d.rud) * SURF_SIGN.rudder;
}

function lerp(a, b, f) { return a + (b - a) * f; }

// ---------- HUD ----------
function updateHud() {
  const tr = trajectories.find((t) => t.visible);
  if (!tr) { hudEl.innerHTML = '<div class="hint">加载 CSV 后显示飞行数据</div>'; return; }
  const d = tr.data;
  const n = d.meta.count;
  const localMs = progress * tr.duration;
  const i = findIndex(d.pt, localMs);
  hudEl.innerHTML = `
    <div class="hud-title"><span class="dot" style="background:#${tr.color.toString(16).padStart(6, '0')}"></span>${escapeHtml(tr.name)}</div>
    <div class="hud-row"><span>时间</span><b>${(localMs / 1000).toFixed(2)} s</b></div>
    <div class="hud-row"><span>高度 AGL</span><b>${d.py[i].toFixed(1)} m</b></div>
    <div class="hud-row"><span>地速</span><b>${d.gs[i].toFixed(1)} m/s</b></div>
    <div class="hud-row"><span>指示空速</span><b>${d.ias[i].toFixed(1)} m/s</b></div>
    <div class="hud-row"><span>迎角</span><b>${d.aoa[i].toFixed(1)}°</b></div>
    <div class="hud-row"><span>滚转 / 俯仰 / 偏航</span><b>${(d.roll[i] * 57.2958).toFixed(1)} / ${(d.pitch[i] * 57.2958).toFixed(1)} / ${(d.yaw[i] * -57.2958).toFixed(1)}°</b></div>
    <div class="hud-row"><span>飞行阶段</span><b>${d.phase[i]}</b></div>
    <div class="hud-sub">舵面 (°)</div>
    <div class="hud-row"><span>升降舵</span><b>${d.elev[i].toFixed(1)}</b></div>
    <div class="hud-row"><span>副翼 左 / 右</span><b>${d.ailL[i].toFixed(1)} / ${d.ailR[i].toFixed(1)}</b></div>
    <div class="hud-row"><span>方向舵</span><b>${d.rud[i].toFixed(1)}</b></div>
    <div class="hud-row"><span>襟副翼 左 / 右</span><b>${d.flaL[i].toFixed(1)} / ${d.flaR[i].toFixed(1)}</b></div>
    <div class="hud-row"><span>双缝襟翼</span><b>${d.flap[i].toFixed(1)}</b></div>
    <div class="hud-row small"><span>点数 ${n} / 原 ${d.meta.rawCount}</span></div>
  `;
}

// ---------- 渲染 ----------
function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
addEventListener('resize', resize);

function animate(now) {
  const dt = _lastFrame ? Math.min(0.05, (now - _lastFrame) / 1000) : 0.016;
  _lastFrame = now;
  if (followEnabled) updateChase(dt);
  else controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
updateHud();
fitView();
animate();

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
