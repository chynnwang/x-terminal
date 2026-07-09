// 把 server/dist 打成单个 ESM 文件 desktop/dist/server.mjs,
// 这样桌面客户端无需携带 server 的 node_modules(pnpm 软链在打包时容易出问题)。
// cpu-features 是 ssh2 的可选原生加速模块,标记为 external 并不打包;ssh2 有纯 JS 回退,不影响使用。
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

await build({
  entryPoints: [path.resolve(root, '../server/dist/index.js')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.resolve(root, 'dist/server.mjs'),
  external: ['cpu-features'],
  // ESM 输出里补 require / __dirname / __filename 三个 shim。
  // ssh2 等依赖在模块作用域引用了它们,ESM 下默认没有,需手动注入。
  banner: {
    js: [
      "import{createRequire as __cr}from'module';",
      "import{fileURLToPath as __ftp}from'url';",
      "import{dirname as __dn}from'path';",
      "const require=__cr(import.meta.url);",
      "const __filename=__ftp(import.meta.url);",
      "const __dirname=__dn(__filename);",
    ].join(''),
  },
  logLevel: 'info',
})

console.log('[bundle-server] done -> desktop/dist/server.mjs')
