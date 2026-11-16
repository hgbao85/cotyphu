#!/usr/bin/env bash
# The four self-play experiments of the balance report, run side by side, then the tables.
#   bash tools/balance/run.sh        (about 10 minutes; npm run balance does the same)
# Raw numbers land in production/qa/balance/*.json, the tables in production/qa/balance/tables.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run build:single >/dev/null
O=production/qa/balance
mkdir -p "$O"
node tools/balance/self-play.mjs A-4vua-phasan   100 ai1,ai1,ai1,ai1 bankrupt "$O/A-4vua-phasan.json" 150 &
node tools/balance/self-play.mjs B-4vua-30vong   200 ai1,ai1,ai1,ai1 rounds   "$O/B-4vua-30vong.json" &
node tools/balance/self-play.mjs C-kho-de-30vong 200 ai2,ai0,ai2,ai0 rounds   "$O/C-kho-de-30vong.json" &
node tools/balance/self-play.mjs D-2vua-phasan   100 ai1,ai1         bankrupt "$O/D-2vua-phasan.json" 150 &
wait
node --experimental-strip-types --no-warnings tools/balance/report.mjs \
  "$O/A-4vua-phasan.json" "$O/B-4vua-30vong.json" "$O/C-kho-de-30vong.json" "$O/D-2vua-phasan.json" > "$O/tables.md"
echo "tables: $O/tables.md"
