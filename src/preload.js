const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("setup", {
  info: () => ipcRenderer.invoke("app:info"),
  detectAll: () => ipcRenderer.invoke("detect:all"),
  install: (ids) => ipcRenderer.invoke("install:start", ids),
  cancel: () => ipcRenderer.invoke("install:cancel"),
  copyLog: () => ipcRenderer.invoke("log:copy"),
  launch: (id) => ipcRenderer.invoke("app:launch", id),
  loginList: (refresh) => ipcRenderer.invoke("login:list", refresh),
  openLogin: (id) => ipcRenderer.invoke("login:open", id),
  onInstallEvent: (fn) => ipcRenderer.on("install:event", (_e, payload) => fn(payload)),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  applyUpdate: () => ipcRenderer.invoke("update:apply"),
  openUpdatePage: () => ipcRenderer.invoke("update:openPage"),
  onUpdateEvent: (fn) => ipcRenderer.on("update:event", (_e, payload) => fn(payload)),
});
