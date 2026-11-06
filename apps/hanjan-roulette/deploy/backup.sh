#!/usr/bin/env bash
# SQLite 안전 백업 (WAL 사용 중에도 안전: better-sqlite3 의 backup()). 매일 cron 으로 돌린다.
# 사용: deploy/backup.sh [DB경로]   (인자 없으면 APP/.env 의 DB_PATH)
set -euo pipefail

# ─ 경로는 여기 한 곳 ─
APP="/srv/hanjan/apps/hanjan-roulette"
BACKUP_DIR="/srv/hanjan-data/backups"
KEEP_DAYS=14

DB="${1:-}"
if [ -z "$DB" ]; then
  [ -f "$APP/.env" ] || { echo "APP/.env 가 없습니다. DB 경로를 인자로 주세요." >&2; exit 1; }
  # .env 를 실행(source)하지 않고 DB_PATH 한 줄만 읽는다
  DB="$(grep -E '^DB_PATH=' "$APP/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi
[ -n "$DB" ] && [ -f "$DB" ] || { echo "DB 파일을 찾을 수 없습니다: ${DB:-<비어 있음>}" >&2; exit 1; }

umask 077
mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/hanjan-$(date +%Y%m%d-%H%M).db"

cd "$APP"
# 임시 파일은 고정 이름 하나. 성공하면 최종 이름으로 옮기고, 실패하면 .tmp 가 남고 다음 실행 시작 때 지운다.
# (*.db 로 끝나지 않아 아래 14일 정리 대상이 아니다.)
TMP="$BACKUP_DIR/hanjan-tmp.db.tmp"
rm -f -- "$TMP"
node --input-type=module -e '
  import Database from "better-sqlite3";
  const [src, dest] = process.argv.slice(1);
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try { await db.backup(dest); } finally { db.close(); }
' "$DB" "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$OUT"
echo "백업 완료: $OUT"

# 14일 넘은 백업만 정리 (이 폴더의 hanjan-*.db 만)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hanjan-*.db' -mtime +"$KEEP_DAYS" -delete
