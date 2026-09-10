import * as THREE from 'three';
import { AIRCRAFT } from './config.js';

// 构建简化飞机模型：机头朝 -Z，+Y 朝上，+X 右翼
// 返回 Group，userData.surfaces 内含各可动舵面（Group，直接设 rotation 即可）
export function buildAircraft(overrides = {}) {
  const cfg = merge(AIRCRAFT, overrides);
  const g = new THREE.Group();
  g.name = 'aircraft';

  const fus = cfg.fuselage;
  const half = fus.length / 2;
  const matFuse = new THREE.MeshStandardMaterial({ color: cfg.colors.fuselage, metalness: 0.2, roughness: 0.7 });
  const matSurf = new THREE.MeshStandardMaterial({ color: cfg.colors.wing, metalness: 0.2, roughness: 0.7 });
  const matCtrl = new THREE.MeshStandardMaterial({ color: cfg.colors.control ?? 0x5a6472, metalness: 0.25, roughness: 0.65 });

  // ---- 机身 ----
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(fus.radius, fus.radius, fus.midLength, 20, 1), matFuse);
  mid.rotation.x = Math.PI / 2;
  mid.position.z = -half + fus.noseLength + fus.midLength / 2;
  g.add(mid);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(fus.radius, fus.noseLength, 20, 1), matFuse);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -half + fus.noseLength / 2;
  g.add(nose);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(fus.tailRadius, fus.radius, fus.tailLength, 20, 1), matFuse);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -half + fus.noseLength + fus.midLength + fus.tailLength / 2;
  g.add(tail);

  // ---- 主翼（前段固定 + 后缘舵面）----
  const w = cfg.wing;
  const wLE = w.z - w.chord / 2;           // 前缘
  const hingeZ = w.z + w.chord / 2 - w.ctrlChord; // 后缘铰链
  const mainWing = new THREE.Mesh(
    new THREE.BoxGeometry(w.span, w.thickness, hingeZ - wLE), matSurf);
  mainWing.position.set(0, w.y, (wLE + hingeZ) / 2);
  g.add(mainWing);

  // 后缘分段（左->右）：副翼 / 襟副翼 / 襟翼 / 襟翼 / 襟副翼 / 副翼
  const seg = w.seg; // [[x0,x1,key], ...] 左到右
  const surfaces = {};
  for (const [x0, x1, key] of seg) {
    const s = makeHinge(g, (x0 + x1) / 2, w.y, hingeZ, [Math.abs(x1 - x0), w.ctrlThickness, w.ctrlChord], matCtrl, 'x');
    surfaces[key] = s;
  }

  // ---- 平尾（T 尾）----
  const ht = cfg.ht;
  const htLE = ht.z - ht.chord / 2;
  const htHinge = ht.z + ht.chord / 2 - ht.ctrlChord;
  const htMain = new THREE.Mesh(new THREE.BoxGeometry(ht.span, ht.thickness, htHinge - htLE), matSurf);
  htMain.position.set(0, ht.y, (htLE + htHinge) / 2);
  g.add(htMain);
  surfaces.elevator = makeHinge(g, 0, ht.y, htHinge, [ht.span, ht.ctrlThickness, ht.ctrlChord], matCtrl, 'x');

  // ---- 垂尾 + 方向舵 ----
  const f = cfg.fin;
  const fLE = f.z - f.chord / 2;
  const fHinge = f.z + f.chord / 2 - f.ctrlChord;
  const finMain = new THREE.Mesh(new THREE.BoxGeometry(f.thickness, f.height, fHinge - fLE), matSurf);
  finMain.position.set(0, f.baseY + f.height / 2, (fLE + fHinge) / 2);
  g.add(finMain);
  // 方向舵铰链绕 Y 轴，枢轴取在垂尾中心高度
  const rudder = makeHinge(g, 0, f.baseY + f.height / 2, fHinge, [f.thickness, f.height, f.ctrlChord], matCtrl, 'y');
  surfaces.rudder = rudder;

  g.userData.surfaces = surfaces;
  return g;
}

// 在父节点上建一个绕 axis('x'|'y') 旋转的铰链：枢轴 pivot，舵面尺寸 size，mesh 向 +Z 偏 size[2]/2
function makeHinge(parent, x, y, z, size, mat, axis) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(0, 0, size[2] / 2);
  group.add(mesh);
  parent.add(group);
  group.userData.axis = axis;
  return group;
}

function merge(a, b) {
  const wing = { ...a.wing, ...(b.wing || {}) };
  if (!wing.seg) {
    // 左->右 后缘分段：[x0, x1, 舵面名]
    wing.seg = [
      [-4.0, -1.8, 'aileronL'],
      [-1.8, -1.15, 'flaperonL'],
      [-1.15, -0.55, 'flapL'],
      [0.55, 1.15, 'flapR'],
      [1.15, 1.8, 'flaperonR'],
      [1.8, 4.0, 'aileronR'],
    ];
    wing.ctrlChord = 0.2;
    wing.ctrlThickness = 0.08;
  }
  const ht = { ...a.ht, ...(b.ht || {}) };
  if (ht.ctrlChord === undefined) { ht.ctrlChord = 0.18; ht.ctrlThickness = 0.06; }
  const fin = { ...a.fin, ...(b.fin || {}) };
  if (fin.ctrlChord === undefined) { fin.ctrlChord = 0.24; }
  return {
    fuselage: { ...a.fuselage, ...(b.fuselage || {}) },
    wing, ht, fin,
    groundOffset: b.groundOffset ?? a.groundOffset,
    colors: { ...a.colors, ...(b.colors || {}) },
  };
}
