// CSV 解析 Worker（classic worker，无模块依赖）
// 输入: { type:'parse', buffer: ArrayBuffer, eps: number }
// 输出: progress / done { arrays..., meta } / error

const COL = {
  TIME: 2, ROLL: 10, PITCH: 11, YAW: 12, LON: 14, LAT: 15, ALT: 16,
  GS: 17, IAS: 21, AOA: 27, SLIP: 28, PHASE: 29, NZ: 9,
  ELEV: 43, AIL_L: 44, AIL_R: 45, RUD: 46, FLA_L: 47, FLA_R: 48, FLAP: 49,
};
const DEG2RAD = Math.PI / 180;
const EARTH_R = 6371000;
const YAW_SIGN = -1;   // 偏航角 -> three yaw
const PITCH_SIGN = 1;
const ROLL_SIGN = 1;

let dec = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== 'parse') return;
  try {
    parse(msg.buffer, msg.eps ?? 0.5);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};

function parse(buffer, eps) {
  dec = new TextDecoder('gbk');
  const bytes = new Uint8Array(buffer);
  const total = bytes.length;

  const t = [], lon = [], lat = [], alt = [], roll = [], pitch = [], yaw = [],
    gs = [], ias = [], aoa = [], slip = [], phase = [];
  const elev = [], ailL = [], ailR = [], rud = [], flaL = [], flaR = [], flap = [];

  let leftover = '';
  let isHeader = true;
  let groundAlt = 0, lat0 = 0, lon0 = 0, haveRef = false;
  let count = 0;
  const CHUNK = 1 << 20;

  const handleLine = (line) => {
    if (line.length === 0) return;
    if (isHeader) { isHeader = false; return; }
    // 行尾 \r
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
    const p = line.split(',');
    if (p.length < 30) return;
    const tt = +p[COL.TIME];
    const la = +p[COL.LAT];
    const lo = +p[COL.LON];
    const al = +p[COL.ALT];
    if (!isFinite(tt) || !isFinite(la) || !isFinite(lo) || !isFinite(al)) return;
    if (!haveRef) { haveRef = true; groundAlt = al; lat0 = la; lon0 = lo; }
    t.push(tt);
    lat.push(la); lon.push(lo); alt.push(al);
    roll.push(+p[COL.ROLL]); pitch.push(+p[COL.PITCH]); yaw.push(+p[COL.YAW]);
    gs.push(+p[COL.GS]); ias.push(+p[COL.IAS]);
    aoa.push(+p[COL.AOA]); slip.push(+p[COL.SLIP]);
    phase.push(+p[COL.PHASE]);
    elev.push(+p[COL.ELEV]); ailL.push(+p[COL.AIL_L]); ailR.push(+p[COL.AIL_R]);
    rud.push(+p[COL.RUD]); flaL.push(+p[COL.FLA_L]); flaR.push(+p[COL.FLA_R]); flap.push(+p[COL.FLAP]);
    count++;
  };

  for (let off = 0; off < total; off += CHUNK) {
    const end = Math.min(off + CHUNK, total);
    let text = dec.decode(bytes.subarray(off, end), { stream: end < total });
    text = leftover + text;
    const lines = text.split('\n');
    leftover = lines.pop();
    for (let i = 0; i < lines.length; i++) handleLine(lines[i]);
    if ((off / CHUNK) % 8 === 0) {
      self.postMessage({ type: 'progress', loaded: end, total });
    }
  }
  leftover += dec.decode(); // flush
  if (leftover.length) handleLine(leftover);

  if (!haveRef || count === 0) {
    self.postMessage({ type: 'error', message: '未解析到有效数据' });
    return;
  }

  // 接地裁剪：最高点之后首次回落到地面
  let iMax = 0;
  for (let i = 1; i < count; i++) if (alt[i] > alt[iMax]) iMax = i;
  let cut = count - 1;
  for (let i = iMax; i < count; i++) {
    if (alt[i] <= groundAlt + eps) { cut = i; break; }
  }
  const keep = cut + 1;

  // ENU 投影 + AGL
  const cosLat0 = Math.cos(lat0 * DEG2RAD);
  const n = keep;
  const px = new Float32Array(n); // East -> +X
  const py = new Float32Array(n); // Up(AGL) -> +Y
  const pz = new Float32Array(n); // -North -> -Z
  const pt = new Float32Array(n);
  const quat = new Float32Array(n * 4);
  const sG = new Float32Array(n), sIas = new Float32Array(n), sAlt = new Float32Array(n);
  const sRoll = new Float32Array(n), sPitch = new Float32Array(n), sYaw = new Float32Array(n);
  const sPhase = new Float32Array(n);
  const sAoa = new Float32Array(n), sSlip = new Float32Array(n);
  const sElev = new Float32Array(n), sAilL = new Float32Array(n), sAilR = new Float32Array(n);
  const sRud = new Float32Array(n), sFlaL = new Float32Array(n), sFlaR = new Float32Array(n), sFlap = new Float32Array(n);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const t0 = t[0];
  for (let i = 0; i < n; i++) {
    const east = (lon[i] - lon0) * DEG2RAD * EARTH_R * cosLat0;
    const north = (lat[i] - lat0) * DEG2RAD * EARTH_R;
    const up = alt[i] - groundAlt;
    px[i] = east; py[i] = up; pz[i] = -north;
    pt[i] = t[i] - t0;
    const r = sRoll[i] = roll[i] * DEG2RAD * ROLL_SIGN;
    const p = sPitch[i] = pitch[i] * DEG2RAD * PITCH_SIGN;
    const y = sYaw[i] = yaw[i] * DEG2RAD * YAW_SIGN;
    eulerYXZtoQuat(p, y, r, quat, i * 4);
    sG[i] = gs[i]; sIas[i] = ias[i]; sAlt[i] = alt[i]; sPhase[i] = phase[i];
    sAoa[i] = aoa[i]; sSlip[i] = slip[i];
    sElev[i] = elev[i]; sAilL[i] = ailL[i]; sAilR[i] = ailR[i];
    sRud[i] = rud[i]; sFlaL[i] = flaL[i]; sFlaR[i] = flaR[i]; sFlap[i] = flap[i];
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] < minY) minY = py[i];
    if (py[i] > maxY) maxY = py[i];
    if (pz[i] < minZ) minZ = pz[i];
    if (pz[i] > maxZ) maxZ = pz[i];
  }

  const result = {
    type: 'done',
    px, py, pz, pt, quat,
    gs: sG, ias: sIas, alt: sAlt, roll: sRoll, pitch: sPitch, yaw: sYaw, phase: sPhase,
    aoa: sAoa, slip: sSlip,
    elev: sElev, ailL: sAilL, ailR: sAilR, rud: sRud, flaL: sFlaL, flaR: sFlaR, flap: sFlap,
    meta: {
      count: n,
      rawCount: count,
      duration: pt[n - 1],
      groundAlt,
      lat0, lon0,
      removedAfterTouchdown: count - n,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    },
  };
  const transfer = [px.buffer, py.buffer, pz.buffer, pt.buffer, quat.buffer,
    sG.buffer, sIas.buffer, sAlt.buffer, sRoll.buffer, sPitch.buffer, sYaw.buffer, sPhase.buffer,
    sAoa.buffer, sSlip.buffer,
    sElev.buffer, sAilL.buffer, sAilR.buffer, sRud.buffer, sFlaL.buffer, sFlaR.buffer, sFlap.buffer];
  self.postMessage(result, transfer);
}

// euler(YXZ): p=绕X, y=绕Y, r=绕Z; q = qY * qX * qZ
function eulerYXZtoQuat(x, y, z, out, o) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
  const qYw = cy, qYx = 0, qYy = sy, qYz = 0;
  const qXw = cx, qXx = sx, qXy = 0, qXz = 0;
  const qZw = cz, qZx = 0, qZy = 0, qZz = sz;
  // q = qY * qX
  const aw = qYw * qXw - qYx * qXx - qYy * qXy - qYz * qXz;
  const ax = qYw * qXx + qYx * qXw + qYy * qXz - qYz * qXy;
  const ay = qYw * qXy - qYx * qXz + qYy * qXw + qYz * qXx;
  const az = qYw * qXz + qYx * qXy - qYy * qXx + qYz * qXw;
  // (* qZ)
  const bw = aw * qZw - ax * qZx - ay * qZy - az * qZz;
  const bx = aw * qZx + ax * qZw + ay * qZz - az * qZy;
  const by = aw * qZy - ax * qZz + ay * qZw + az * qZx;
  const bz = aw * qZz + ax * qZy - ay * qZx + az * qZw;
  out[o] = bx; out[o + 1] = by; out[o + 2] = bz; out[o + 3] = bw;
}
