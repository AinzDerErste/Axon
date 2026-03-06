import { Menu, BrowserWindow } from 'electron'

export function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Map',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-map')
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('open')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save')
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('save-as')
        },
        { type: 'separator' },
        {
          label: 'Export as PNG...',
          click: () => sendMenuAction('export-png')
        },
        {
          label: 'Export as JSON...',
          click: () => sendMenuAction('export-json')
        },
        {
          label: 'Export as TMX (Tiled)...',
          click: () => sendMenuAction('export-tmx')
        },
        {
          label: 'Export for Godot (.tscn)...',
          click: () => sendMenuAction('export-godot')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => sendMenuAction('undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => sendMenuAction('redo')
        },
        { type: 'separator' },
        {
          label: 'Map Properties…',
          click: () => sendMenuAction('map-properties')
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          click: () => sendMenuAction('settings')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Grid',
          accelerator: 'CmdOrCtrl+G',
          click: () => sendMenuAction('toggle-grid')
        },
        { type: 'separator' },
        { role: 'reload' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function sendMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win) {
    win.webContents.send('menu:action', action)
  }
}
