#!/usr/bin/env bash
# DSH 人格插件评测入口。DSH 0.2.1-rc.2 没有 harness eval 子命令，
# 这里用 Node 自带 test runner + 真实 Cordis 集成 + 真实 dsh 安装链路代替。
# Node 22.22 原生 TS 剥离，.test.ts 可直接跑，无需 ts-node / vitest。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5  TypeScript 类型检查 =="
npm run typecheck

echo "== 2/5  v3 机制测试 T-01..T-30（.test.ts 原生跑，60 项断言） =="
node --test tests/*.test.ts

echo "== 3/5  v1 引擎回归 T-01..T-18（26 项断言，规则库不退化） =="
node --test tests/unit.test.mjs

echo "== 4/5  真实 Cordis + dsh-system-prompt 集成（含 T-24/T-28/T-29/T-30 哨兵） =="
node tests/integration.mjs

echo "== 5/5  dsh plugin add / --dump-config 安装链路 + mock 宿主事件链路 =="
node tests/verify-dsh.mjs

echo "ALL PASS"
