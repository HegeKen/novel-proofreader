#!/usr/bin/env bash
# 把本地签名材料写入 GitHub 仓库 Secrets。
#
# 前置：
#   1. 已运行 `pnpm run setup:signing`
#   2. 已安装并登录 gh CLI（gh auth login）
#
# 用法：
#   bash scripts/ci/push-secrets.sh              # 推送到当前仓库
#   REPO=owner/name bash scripts/ci/push-secrets.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE=".signing/signing.env"
KEYSTORE_B64=".signing/android-keystore.base64"
UPDATER_KEY=".signing/updater.key"

if ! command -v gh >/dev/null 2>&1; then
  echo "✗ 未找到 gh CLI。安装: brew install gh 然后 gh auth login" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ 缺少 $ENV_FILE，请先运行: pnpm run setup:signing" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

REPO_ARG=()
if [ -n "${REPO:-}" ]; then
  REPO_ARG=(--repo "$REPO")
fi

set_secret() {
  local name="$1"
  local value="${2:-}"
  if [ -z "$value" ]; then
    echo "· 跳过 $name（未配置）"
    return 0
  fi
  printf '%s' "$value" | gh secret set "$name" "${REPO_ARG[@]}" >/dev/null
  echo "✓ 已写入 $name"
}

set_secret_from_file() {
  local name="$1"
  local file="$2"
  if [ ! -f "$file" ]; then
    echo "· 跳过 $name（缺少 $file）"
    return 0
  fi
  gh secret set "$name" "${REPO_ARG[@]}" < "$file" >/dev/null
  echo "✓ 已写入 $name (来自 $file)"
}

echo "→ 推送发布签名 Secrets"

# --- Android ---
set_secret_from_file ANDROID_KEYSTORE_BASE64 "$KEYSTORE_B64"
set_secret ANDROID_KEYSTORE_PASSWORD "${ANDROID_KEYSTORE_PASSWORD:-}"
set_secret ANDROID_KEY_ALIAS "${ANDROID_KEY_ALIAS:-}"
set_secret ANDROID_KEY_PASSWORD "${ANDROID_KEY_PASSWORD:-}"

# --- Tauri updater ---
set_secret_from_file TAURI_SIGNING_PRIVATE_KEY "$UPDATER_KEY"
set_secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# --- macOS ---
set_secret APPLE_CERTIFICATE "${APPLE_CERTIFICATE:-}"
set_secret APPLE_CERTIFICATE_PASSWORD "${APPLE_CERTIFICATE_PASSWORD:-}"
set_secret APPLE_SIGNING_IDENTITY "${APPLE_SIGNING_IDENTITY:-}"
set_secret APPLE_ID "${APPLE_ID:-}"
set_secret APPLE_PASSWORD "${APPLE_PASSWORD:-}"
set_secret APPLE_TEAM_ID "${APPLE_TEAM_ID:-}"
set_secret APPLE_API_KEY "${APPLE_API_KEY:-}"
set_secret APPLE_API_ISSUER "${APPLE_API_ISSUER:-}"
set_secret APPLE_API_KEY_P8 "${APPLE_API_KEY_P8:-}"

# --- Windows ---
set_secret WINDOWS_CERTIFICATE "${WINDOWS_CERTIFICATE:-}"
set_secret WINDOWS_CERTIFICATE_PASSWORD "${WINDOWS_CERTIFICATE_PASSWORD:-}"
set_secret AZURE_TENANT_ID "${AZURE_TENANT_ID:-}"
set_secret AZURE_CLIENT_ID "${AZURE_CLIENT_ID:-}"
set_secret AZURE_CLIENT_SECRET "${AZURE_CLIENT_SECRET:-}"
set_secret AZURE_CODE_SIGNING_ENDPOINT "${AZURE_CODE_SIGNING_ENDPOINT:-}"
set_secret AZURE_CODE_SIGNING_ACCOUNT "${AZURE_CODE_SIGNING_ACCOUNT:-}"
set_secret AZURE_CODE_SIGNING_CERTIFICATE_PROFILE "${AZURE_CODE_SIGNING_CERTIFICATE_PROFILE:-}"

echo
echo "完成。查看: gh secret list"
