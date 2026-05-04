const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain } = require('electron')
const { spawn } = require('child_process')
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

let mainWindow = null
let tray = null
let llamaProcess = null
let voiceProcess = null
let kamilProcess = null
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

  mainWindow.loadURL(KAMIL_URL)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => mainWindow.loadURL(KAMIL_URL), 3000)
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
        setTimeout(() => spawnVoice(), 10000)
      }
    })
  }, 30000)
}

function spawnKamil() {
  console.log('Starting Kamil backend...')
  kamilProcess = spawn(PYTHON, ['run.py'], { cwd: KAMIL_DIR })
  kamilProcess.stdout.on('data', d => console.log('[kamil]', d.toString().trim()))
  kamilProcess.stderr.on('data', d => console.error('[kamil]', d.toString().trim()))
  kamilProcess.on('exit', (code) => {
    if (!isQuitting) {
      console.log(`Kamil backend exited (${code}), restarting in 5s...`)
      setTimeout(spawnKamil, 5000)
    }
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
  spawnLlama()
  setTimeout(spawnKamil, 60000)
  createWindow()
  createTray()
  registerHotkey()
})

app.on('window-all-closed', (e) => e.preventDefault())

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (llamaProcess) llamaProcess.kill()
  if (voiceProcess) voiceProcess.kill()
  if (kamilProcess) kamilProcess.kill()
})

app.on('activate', () => mainWindow && mainWindow.show())

ipcMain.handle('get-status', () => ({
  llama: !!(llamaProcess && !llamaProcess.killed),
  voice: !!(voiceProcess && !voiceProcess.killed),
  kamil: !!(kamilProcess && !kamilProcess.killed),
}))