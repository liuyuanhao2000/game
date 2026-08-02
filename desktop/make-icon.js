// 纯 Node 生成桌面图标 PNG（零依赖：zlib deflate + 逐像素绘制）
// 图案：深蓝圆角底 + 金色环 + 红色棋子盘（与游戏配色一致）
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // 位深
  ihdr[9] = 6;  // RGBA
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // 滤波器：None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const S = 512, C = S / 2;
function pixel(x, y) {
  const dx = x - C + 0.5, dy = y - C + 0.5;
  const d = Math.hypot(dx, dy);
  // 圆角方形背景（半径 r 的圆角）
  const r = 100;
  const qx = Math.abs(dx) - (C - r), qy = Math.abs(dy) - (C - r);
  const cornerD = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  if (Math.max(qx, qy) > r || (qx > 0 && qy > 0 && cornerD > r)) return [0, 0, 0, 0]; // 圆角外透明
  if (d < 170) {
    if (d > 152) return [255, 209, 102, 255]; // 金环
    if (d > 140) return [240, 163, 156, 255]; // 浅红描边
    if (d < 60) return [214, 87, 80, 255];    // 盘心高光
    return [200, 65, 58, 255];                // 红色棋子盘
  }
  return [21, 49, 74, 255];                   // 深蓝底
}

fs.writeFileSync(path.join(__dirname, 'icon.png'), png(S, S, pixel));
console.log('icon.png 已生成（512×512）');
