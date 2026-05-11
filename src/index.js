const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain } = require('electron')
const { spawn, fork } = require('child_process')
const path = require('path')

if (require('electron-squirrel-startup')) app.quit()

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault()
  callback(true)
})

const KAMIL_URL = 'http://127.0.0.1:3000'
const KAMIL_DIR = 'C:\\kamil'
const PYTHON = 'C:\\kamil\\venv313\\Scripts\\python.exe'
const LLAMA_SERVER = 'C:\\llama.cpp\\build\\bin\\llama-server.exe'
const MODEL = 'C:\\kamil\\models\\deepseek-r1-distill-14b-q4.gguf'
const VOICE_MODEL = 'C:\\kamil\\models\\gemma4-e4b-q4.gguf'
const EXECUTOR_MODEL = 'C:\\kamil\\models\\qwen2.5-3b-executor-q8.gguf'

let mainWindow = null
let tray = null
let llamaProcess = null
let voiceProcess = null
let executorProcess = null
let kamilProcess = null
let emcpProcess = null
let isQuitting = false

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 680,
        minWidth: 600,
        minHeight: 400,
        backgroundColor: '#080808',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            autoplayPolicy: 'no-user-gesture-required',
        },
        show: false,
        autoHideMenuBar: true,
    })

    // Do NOT call loadURL here – waitForKamil will load it when the backend is ready
    mainWindow.once('ready-to-show', () => mainWindow.show())
    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault()
            mainWindow.hide()
        }
    })
    mainWindow.webContents.on('did-fail-load', () => {
        // Retry loading after a short delay if it fails
        setTimeout(waitForKamil, 3000)
    })
}

function createTray() {
  const { nativeImage } = require('electron')
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAOklEQVQ4jWNgYGD4z8BAAAADAAFjVmRmAAAAAElFTkSuQmCC'
  )
  tray = new Tray(icon)
  tray.setToolTip('Kamil — Local AI')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Kamil', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
  ]))
  tray.on('click', () => {
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus())
  })
}

function spawnEmcp() {
  console.log('Starting emcp bridge...')
  emcpProcess = fork(path.join(__dirname, 'emcp_server.js'), [], { silent: true })
  emcpProcess.stdout.on('data', d => console.log('[emcp]', d.toString().trim()))
  emcpProcess.stderr.on('data', d => console.error('[emcp]', d.toString().trim()))
  emcpProcess.on('exit', (code) => {
    if (!isQuitting) {
      console.log(`emcp exited (${code}), restarting in 5s...`)
      setTimeout(spawnEmcp, 5000)
    }
  })
}

function spawnLlama() {
  console.log('Starting primary model...')
  llamaProcess = spawn(LLAMA_SERVER, [
    '-m', MODEL, '-c', '8192', '-ngl', '99',
    '--host', '0.0.0.0', '--port', '8080', '--log-disable'
  ])
  llamaProcess.on('exit', (code) => {
    if (!isQuitting) {
      console.log(`Primary exited (${code}), restarting in 20s...`)
      setTimeout(() => spawnLlama(), 20000)
    }
  })

  // Start voice model after 30 seconds
  setTimeout(() => {
    console.log('Starting voice model...')
    voiceProcess = spawn(LLAMA_SERVER, [
      '-m', VOICE_MODEL, '-c', '4096', '-ngl', '99',
      '--host', '0.0.0.0', '--port', '8084', '--log-disable'
    ])
    voiceProcess.on('exit', (code) => {
      if (!isQuitting) {
        console.log(`Voice model exited (${code}), restarting in 10s...`)
        setTimeout(() => {
          if (!isQuitting) {
            voiceProcess = spawn(LLAMA_SERVER, [
              '-m', VOICE_MODEL, '-c', '4096', '-ngl', '99',
              '--host', '0.0.0.0', '--port', '8084', '--log-disable'
            ])
          }
        }, 10000)
      }
    })
  }, 30000)
}

function spawnExecutor() {
    console.log('Starting executor model...')
    executorProcess = spawn(LLAMA_SERVER, [
        '-m', EXECUTOR_MODEL, '-c', '2048', '-ngl', '99',
        '--host', '0.0.0.0', '--port', '8083', '--log-disable'
    ])
    executorProcess.stdout.on('data', d => process.stdout.write(`[executor] ${d}`))
    executorProcess.stderr.on('data', d => process.stderr.write(`[executor] ${d}`))
    executorProcess.on('exit', (code) => {
        if (!isQuitting) {
            console.log(`Executor exited (${code}), restarting in 10s...`)
            setTimeout(spawnExecutor, 10000)
        }
    })
}

function spawnKamil() {
    console.log('Starting Kamil backend...')
    kamilProcess = spawn(PYTHON, ['run.py'], { cwd: KAMIL_DIR })
    kamilProcess.stdout.on('data', d => process.stdout.write(`[kamil] ${d}`))
    kamilProcess.stderr.on('data', d => process.stderr.write(`[kamil] ${d}`))
    kamilProcess.on('exit', (code) => {
        if (!isQuitting) {
            console.log(`Kamil backend exited (${code}), restarting in 5s...`)
            setTimeout(spawnKamil, 5000)
        }
    })
}

function waitForKamil() {
    const http = require('http')
    http.get('http://127.0.0.1:3000/', (res) => {
        console.log('Kamil backend ready — loading UI')
        mainWindow.loadURL(KAMIL_URL)
    }).on('error', () => {
        // Not ready yet — retry in 2 seconds
        setTimeout(waitForKamil, 2000)
    })
}

function registerHotkey() {
  globalShortcut.register('CommandOrControl+Space', () => {
    if (!mainWindow) return
    mainWindow.isVisible() && mainWindow.isFocused()
      ? mainWindow.hide()
      : (mainWindow.show(), mainWindow.focus())
  })
}

app.whenReady().then(() => {
    spawnEmcp()
    spawnLlama()
    
    // Start backend after a short delay (llama needs time to load model)
    setTimeout(spawnKamil, 5000)
    
    createWindow()   // window created but blank
    createTray()
    registerHotkey()
    
    // Start executor model after 35 seconds
    setTimeout(spawnExecutor, 35000)
    
    // Poll until backend responds instead of fixed timeout
    setTimeout(waitForKamil, 8000)  // start polling after 8 seconds
})

app.on('window-all-closed', (e) => e.preventDefault())

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (llamaProcess) llamaProcess.kill()
  if (voiceProcess) voiceProcess.kill()
  if (executorProcess) executorProcess.kill()
  if (kamilProcess) kamilProcess.kill()
  if (emcpProcess) emcpProcess.kill()
})

app.on('web-contents-created', (event, contents) => {
  contents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error']
    console.log(`[renderer:${levels[level]}] ${message}`)
  })
})

app.on('activate', () => mainWindow && mainWindow.show())

ipcMain.handle('get-status', () => ({
  llama: !!(llamaProcess && !llamaProcess.killed),
  voice: !!(voiceProcess && !voiceProcess.killed),
  executor: !!(executorProcess && !executorProcess.killed),
  kamil: !!(kamilProcess && !kamilProcess.killed),
  emcp: !!(emcpProcess && !emcpProcess.killed),
}))