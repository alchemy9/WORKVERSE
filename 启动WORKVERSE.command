#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null; then
  export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null; then
  echo '没有找到 Node.js，请先安装 Node.js 24。'
  read '?按回车关闭'
  exit 1
fi
if [[ ! -d workverse/server/node_modules/ws ]]; then
  echo '首次启动需要安装已锁定的连接依赖。'
  (cd workverse/server && npm ci --ignore-scripts --no-audit --no-fund) || exit 1
fi
node workverse/server/index.mjs --open
read '?服务已停止，按回车关闭'
