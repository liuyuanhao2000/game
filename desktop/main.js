// 军旗翻翻棋 — Electron 主进程
// 仅负责开窗加载游戏页面；游戏本体零改动（纯静态页面 + localStorage + Web Audio 均可直接用）。
'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 880,                 // 契合 5×12 棋盘竖屏比例
    minWidth: 360,
    minHeight: 640,
    title: '军旗翻翻棋',
    backgroundColor: '#15314a',  // 与游戏底色一致，避免白闪
    autoHideMenuBar: true,       // 隐藏菜单栏（Alt 仍可唤出）
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,    // 游戏不需要 Node 能力，保持安全默认
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  // 外链用系统浏览器打开（本游戏无导航需求，防御性设置）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {     // macOS 点 Dock 图标重开窗
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
