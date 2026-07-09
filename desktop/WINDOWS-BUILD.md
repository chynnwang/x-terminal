# Windows 打包说明(交给 Windows 上的 AI agent 执行)

本文件用于在 **Windows 机器**上把「X terminal」打包成 `.exe` 安装器(NSIS)。
Mac 的 `.dmg` 已在别处打好,这里只负责 Windows 包。请严格按步骤执行。

---

## 0. 这个项目是什么

- pnpm monorepo:`server/`(Node + TS 后端)、`web/`(Vue3 + Vite 前端)、`desktop/`(Electron 客户端)。
- 打包思路:esbuild 把后端打成单文件 `desktop/dist/server.mjs`,前端产物在 `web/dist`,Electron 主进程内嵌启动后端(随机端口)、窗口加载前端。
- **不含任何原生模块需要编译**:后端依赖全是纯 JS;`cpu-features`(ssh2 的可选原生加速)已被 esbuild 标记 external 不打包,ssh2 有纯 JS 回退。
- **所以 Windows 上不需要安装 Visual Studio Build Tools / Python**。

---

## 1. 前置环境

在 Windows 上准备好:

1. **Node.js 18 或 20 LTS**(推荐 20)。验证:`node -v`
2. **pnpm**(v9+)。没有就装:`npm i -g pnpm`。验证:`pnpm -v`
3. **git**(可选,只要能把代码弄到本机即可)。

> 不需要 Python、不需要 Visual Studio、不需要 windows-build-tools。

---

## 2. 拿到代码

把整个仓库(项目根目录,里面有 `server/ web/ desktop/ pnpm-workspace.yaml package.json`)拷到 Windows。

**注意:** 不要只拷 `desktop/` 目录——打包需要同时用到 `server/` 和 `web/`。

不用管 `.env`(它被 gitignore 了,也不该带;桌面包本来就不含任何网关/主机数据)。
不用管别人机器上的 `node_modules`、`dist`、`release`,这些在 Windows 上会重新生成。

---

## 3. 安装依赖

在**项目根目录**打开 PowerShell 或 CMD:

```powershell
pnpm install
```

- 首次安装会下载 Electron 的 Windows 二进制,较大,若网络慢报超时,用:
  ```powershell
  pnpm install --fetch-timeout 600000
  ```
- 若日志里出现 `cpu-features` 构建失败的告警 —— **可以忽略**。它是 ssh2 的可选加速模块,失败会自动走纯 JS 回退,不影响打包和使用。
- 若 pnpm 提示某些包的构建脚本被忽略(ERR_PNPM_IGNORED_BUILDS),项目根 `pnpm-workspace.yaml` 里已配置 `allowBuilds`(含 `electron: true`);正常 `pnpm install` 会执行 electron 的 postinstall。如仍被忽略,可执行 `pnpm rebuild electron` 或 `pnpm approve-builds` 后重装。

---

## 4. 打包

在**项目根目录**执行:

```powershell
pnpm build:desktop:win
```

这条命令会依次:
1. 编译后端 `server/` → esbuild 打成 `desktop/dist/server.mjs`
2. 构建前端 `web/` → `web/dist`
3. 编译 Electron 主进程 → `desktop/dist/main.js`
4. `electron-builder --win nsis` 生成安装器

- electron-builder 首次运行会从 GitHub 下载 `nsis`、`winCodeSign` 等构建资源(需要联网)。若下载失败多为网络问题,重试即可;必要时给命令行配代理。
- 打包过程**不会**做代码签名(没有证书),属正常,见第 6 节。

等价的手动分步(排错时用):

```powershell
pnpm --filter desktop run build:server
pnpm --filter desktop run build:web
pnpm --filter desktop run build:main
pnpm --filter desktop exec electron-builder --win nsis
```

---

## 5. 产物位置

打完在:

```
desktop/release/X-terminal-0.1.0-setup.exe
```

(`0.1.0` 是 `desktop/package.json` 里的 version,改版本号产物名会跟着变。)

这就是要分发的 Windows 安装包。双击运行是 NSIS 安装器,可选安装目录(已配置 `oneClick:false` + `allowToChangeInstallationDirectory:true`)。

---

## 6. 关于「未知发布者」提示

安装包**没有做代码签名**,所以:
- 运行安装器时 Windows SmartScreen 可能提示「Windows 已保护你的电脑 / 未知发布者」。
- 这是未签名应用的正常现象,点「更多信息」→「仍要运行」即可。
- 要消除该提示需接入代码签名证书(EV/OV 证书 + 在 `desktop/package.json` 的 `build.win` 里配 `certificateFile`/`certificatePassword` 或走 CI 签名),本次不做。

---

## 7. 装完后自检清单

安装并打开后,确认:

- [ ] 首次打开**直接进主界面**,不要求设置密码(默认免密,可后续在左下「安全设置」里加密码)。
- [ ] 左侧主机列表为空、顶部模型徽章显示「⚙ 大模型设置」(说明没带任何数据/网关,是干净的包)。
- [ ] 「+ 新增」加一台主机能正常 SSH 连接;终端能输入、能看到命令解读面板。
- [ ] 「文件传输」子标签能浏览/上传/下载。
- [ ] 顶部标题栏与深色界面融为一体、窗口控件在右上(Windows 用 titleBarOverlay),顶栏可拖拽移动窗口。
- [ ] 数据写在 `%APPDATA%\X terminal\data`(即 `C:\Users\<你>\AppData\Roaming\X terminal\data`),卸载/删除该目录即回到全新状态。

---

## 8. 可选:自定义应用图标

当前用的是 Electron 默认图标。要换成自定义图标:
1. 准备一个 `256x256`(或更大)的 `.ico` 文件,放到 `desktop/build/icon.ico`。
2. `desktop/package.json` 的 `build.win` 里加 `"icon": "build/icon.ico"`。
3. 重新执行第 4 步。

---

## 9. 常见问题速查

| 现象 | 处理 |
|------|------|
| `pnpm install` 卡在下载/超时 | 加 `--fetch-timeout 600000` 重试;必要时配 npm/pnpm 代理 |
| `cpu-features` 构建报错 | 忽略,可选依赖,有纯 JS 回退 |
| electron-builder 下载 nsis/winCodeSign 失败 | 网络问题,重试或配代理 |
| 提示缺少 `server.mjs` / `web` | 说明 `prepare:all` 没跑完;按第 4 节手动分步逐条执行定位哪步失败 |
| 打开后连不上主机 | 先确认填的**主机地址/IP 正确**(这是最常见原因,不是程序问题) |
