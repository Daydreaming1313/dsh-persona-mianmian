#!/usr/bin/env bash
# DSH 人格插件评测入口。DSH 0.2.1-rc.2 没有 harness eval 子命令，
# 这里用 Node 自带 test runner + 真实 Cordis 集成 + 真实 dsh 安装链路代替。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4  TypeScript 类型检查 =="
npm run typecheck

echo "== 2/4  T-01..T-18 可执行断言 =="
node --test tests/unit.test.mjs

echo "== 3/4  真实 Cordis + dsh-system-prompt 集成 =="
node tests/integration.mjs

echo "== 4/4  dsh plugin add / --dump-config 安装链路 =="
node tests/verify-dsh.mjs

echo "ALL PASS"
