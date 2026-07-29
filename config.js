/* 静态部署（无后端）默认配置：关闭后端，走浏览器 localStorage。
   若由本项目的 Node 后端（server.js）托管，server 会动态返回 enabled:true 覆盖本文件。 */
window.BOARD_CONFIG = { enabled: false, base: '' };
