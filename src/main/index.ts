import { app, BrowserWindow, shell, protocol, net, ipcMain } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { is } from '@electron-toolkit/utils'
import { DatabaseManager } from './db/DatabaseManager'
import { registerSettingsHandlers } from './ipc/settingsHandlers'
import { registerLLMHandlers } from './ipc/llmHandlers'
import { registerSearchHandlers } from './ipc/searchHandlers'
import { registerProjectHandlers } from './ipc/projectHandlers'

// ─── patent:// 프로토콜 ───────────────────────────────────────────────────────
//
// app.whenReady() 이전에 반드시 호출해야 한다.
// secure + standard 권한을 부여하면 Chromium이 이 scheme을 https:// 수준으로 취급하며
// <iframe> src, fetch(), CSP frame-src 등에서 허용된다.
//
// 목적: PdfPreviewPanel에서 blob URL 대신 patent://pdf?path=... 를 사용해
// ERR_BLOCKED_BY_CSP 없이 Electron 보안 구조를 유지하며 PDF를 표시한다.
//
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'patent',
    privileges: {
      secure: true,       // HTTPS와 동일한 보안 등급
      standard: true,     // URL 파싱 규칙 적용 (host/path 분리 등)
      supportFetchAPI: true,
      bypassCSP: false,   // CSP 우회 허용 안 함 — frame-src에 patent: 추가로 대응
    },
  },
])

// ─── BrowserWindow 생성 ────────────────────────────────────────────────────────

let _mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  // CSP: frame-src에 patent: 추가 — blob: iframe 대신 patent:// iframe을 허용한다.
  // default-src 'self' 는 기본 리소스를 same-origin으로 제한하되
  // script/style은 Vite HMR과 Tailwind inline style을 위해 'unsafe-inline' 허용.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
            'patent:',        // patent:// 리소스 허용 (PDF 뷰어)
            'data:',          // data: URI (아이콘 등)
            'blob:',          // blob: URI (필요 시 하위 호환)
            "connect-src *",  // IPC/fetch 요청 허용
            "frame-src 'self' patent:",  // iframe: self + patent:// 만 허용
          ].join('; '),
        ],
      },
    })
  })

  _mainWindow = mainWindow
  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── 앱 초기화 ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // ── patent:// 프로토콜 핸들러 등록 ──────────────────────────────────────────
  //
  // patent://pdf?path=C%3A%5C...%5Cfile.pdf  → 해당 PDF 파일을 application/pdf로 반환
  //
  // 보안 제약:
  //   - .pdf 확장자 파일만 허용
  //   - 파일 읽기 오류 시 500 반환 (경로 정보 노출 안 함)
  //
  protocol.handle('patent', async (request) => {
    try {
      const url = new URL(request.url)

      if (url.host !== 'pdf') {
        return new Response('Not Found', { status: 404 })
      }

      const filePath = url.searchParams.get('path')
      if (!filePath) {
        return new Response('Bad Request: missing path', { status: 400 })
      }

      // .pdf 파일만 허용 — 임의 파일 읽기 방지
      if (!filePath.toLowerCase().endsWith('.pdf')) {
        return new Response('Forbidden: only .pdf files are allowed', { status: 403 })
      }

      // 파일 존재 여부 확인
      try {
        await fs.promises.access(filePath, fs.constants.R_OK)
      } catch {
        return new Response('Not Found: file not accessible', { status: 404 })
      }

      const buffer = await fs.promises.readFile(filePath)
      return new Response(buffer, {
        headers: { 'Content-Type': 'application/pdf' },
      })
    } catch (err) {
      console.error('[patent://] handler error:', err)
      return new Response('Internal Server Error', { status: 500 })
    }
  })

  // ── DB + IPC 핸들러 초기화 ────────────────────────────────────────────────────
  //
  // sql.js WASM 로딩이 비동기이므로 DB가 완전히 준비된 후에
  // IPC 핸들러를 등록해야 "DB not ready" race condition을 방지할 수 있다.
  //
  const db = await DatabaseManager.getInstance()
  console.log('[App] Database ready')

  registerSettingsHandlers()
  registerLLMHandlers(db)
  registerSearchHandlers(db)
  registerProjectHandlers(db)

  // 창 컨트롤 IPC
  ipcMain.on('window:minimize', () => _mainWindow?.minimize())
  ipcMain.on('window:close', () => _mainWindow?.close())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    DatabaseManager.getInstance().then((db) => db.save())
    app.quit()
  }
})

process.on('exit', () => {
  DatabaseManager.getInstance()
    .then((db) => db.save())
    .catch(() => { /* already exiting */ })
})
