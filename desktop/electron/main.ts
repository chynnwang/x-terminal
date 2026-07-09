import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// 桌面客户端主进程:
//  1. 把数据目录指向 userData(与仓库隔离,分发的安装包里不含任何主机/网关数据)
//  2. 内嵌启动 server(随机端口,避免与已占用端口冲突)
//  3. BrowserWindow 加载 http://localhost:<port>/,前端与 API/WS 同源

// 显式固定 app 名,让 userData 目录在 dev(electron .)和打包版都统一为 "X terminal"。
// 否则 dev 会用 package.json 的 name("desktop")作目录名,和打包版(productName)不一致。
// 必须在读取 app.getPath('userData') 之前调用。
app.setName('X terminal')

let mainWindow: BrowserWindow | null = null

// 打包后:server.mjs 与 web 都在 process.resourcesPath 下(见 package.json build.extraResources)
// 开发运行(electron .):从 desktop/dist 与 ../web/dist 取
function resolvePaths() {
  if (app.isPackaged) {
    return {
      serverBundle: path.join(process.resourcesPath, 'server.mjs'),
      webDir: path.join(process.resourcesPath, 'web'),
    }
  }
  const distDir = path.join(__dirname) // desktop/dist
  return {
    serverBundle: path.join(distDir, 'server.mjs'),
    webDir: path.resolve(distDir, '../../web/dist'),
  }
}

async function boot() {
  const { serverBundle, webDir } = resolvePaths()

  const dataDir = path.join(app.getPath('userData'), 'data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

  process.env.SSH_TERM_EMBEDDED = '1'
  process.env.SSH_TERM_DATA_DIR = dataDir
  process.env.SSH_TERM_WEB_DIR = webDir

  // server bundle 是 ESM,CJS 主进程用动态 import 加载
  const mod = await import(pathToFileURL(serverBundle).href)
  const { port } = await mod.startServer({ port: 0, webDir })

  // 标题栏与深色界面融为一体:mac 用 hiddenInset(红绿灯浮在内容上,顶栏自绘);
  // win 用 hidden + titleBarOverlay(窗口控件浮在右侧,颜色跟随深色主题)。
  // 前端顶栏会据此让出红绿灯/窗口控件的位置并作为可拖拽区域(见 App.vue)。
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'X terminal',
    titleBarStyle: 'hidden',
    trafficLightPosition: isMac ? { x: 14, y: 15 } : undefined,
    titleBarOverlay: isMac
      ? undefined
      : { color: '#161b22', symbolColor: '#c9d1d9', height: 46 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 外部链接用系统浏览器打开,不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(`http://localhost:${port}/`)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(boot).catch((err) => {
  console.error('[desktop] 启动失败:', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) boot()
})
