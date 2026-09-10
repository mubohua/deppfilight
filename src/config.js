// 全局配置：飞机尺寸参数 + CSV 列定义
// 单位：米

// 简化飞机模型参数（原点在机身中心/重心，+X 右翼，+Y 上，-Z 机头）
export const AIRCRAFT = {
  fuselage: {
    length: 5.0,       // 机身长
    radius: 0.5,       // 圆形截面半径（直径 1m）
    midLength: 2.6,    // 中段等直长度
    noseLength: 1.2,   // 机头收细段
    tailLength: 1.2,   // 机尾收尾段
    tailRadius: 0.12,  // 尾端半径
  },
  wing: {
    span: 8.0,         // 翼展
    chord: 0.8,        // 弦长
    thickness: 0.1,    // 厚度
    y: 0.0,            // 安装高度（机身中心）
    z: 0.0,            // 纵向位置（机身中段）
  },
  fin: {
    height: 1.0,       // 垂尾在机身上方的高度（机顶 -> 尾顶）
    chord: 0.8,
    thickness: 0.08,
    baseY: 0.5,        // 机顶
    z: 1.8,            // 垂尾纵向位置
  },
  ht: {
    span: 2.6,         // 平尾展长
    chord: 0.6,
    thickness: 0.08,
    y: 1.5,            // 垂尾顶端
    z: 1.8,
  },
  // 让机身底部在 AGL=0 时正好贴地（轨迹高度按重心计）
  groundOffset: 0.5,
  colors: {
    fuselage: 0xc8ccd2,
    wing: 0x8b93a1,
    tail: 0x8b93a1,
    control: 0x5a6472,
  },
};

// CSV 列索引（0 基）
export const COL = {
  TIME: 2,
  ROLL: 10,
  PITCH: 11,
  YAW: 12,
  LON: 14,
  LAT: 15,
  ALT: 16,
  GS: 17,
  IAS: 21,
  AOA: 27,
  SLIP: 28,
  PHASE: 29,
  NZ: 9,
  // 舵面（单位：度）
  ELEV: 43,   // 升降舵指令
  AIL_L: 44,  // 左侧副翼指令
  AIL_R: 45,  // 右侧副翼指令
  RUD: 46,    // 方向舵指令（向左为正）
  FLA_L: 47,  // 左襟副翼指令
  FLA_R: 48,  // 右襟副翼指令
  FLAP: 49,   // 双缝襟翼指令
};

// 舵面符号约定：升降舵/副翼/襟翼“后缘向下为正”，方向舵“向左为正”
export const SURF_SIGN = {
  elevator: 1,
  aileronL: 1,
  aileronR: 1,
  flaperonL: 1,
  flaperonR: 1,
  flap: 1,
  rudder: -1, // rotation.y = -角度 -> 后缘向左
};

// 接地判定：最高点之后，高度回落到 地面高 + EPS 即视为接地
export const GROUND_EPS = 0.5;

export const DEG2RAD = Math.PI / 180;
export const EARTH_R = 6371000;

// 多文件配色
export const PALETTE = [
  0x4f8cff, 0xff6b6b, 0x37c978, 0xffa94d, 0xb47cff,
  0x00c2d1, 0xffd43b, 0xff7ad9, 0x8ce99a, 0x94a3b8,
];
