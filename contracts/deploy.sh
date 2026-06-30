#!/usr/bin/env bash
#
# Zentra two-contract deployment workflow (Stellar testnet).
# Builds, deploys, and wires the Reputation + Action Log contracts, then prints
# the ids to paste into src/config/contract.ts.
#
# Usage:  SOURCE=zentra-deployer ./contracts/deploy.sh
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-zentra-deployer}"
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"

cd "$(dirname "$0")"

echo "==> Building contracts"
( cd zentra-reputation && stellar contract build )
( cd zentra-action-log && stellar contract build )

REP_WASM="zentra-reputation/target/wasm32v1-none/release/zentra_reputation.wasm"
LOG_WASM="zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm"

echo "==> Deploying reputation (admin=$ADMIN)"
REPUTATION=$(stellar contract deploy --wasm "$REP_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --admin "$ADMIN")
echo "    reputation = $REPUTATION"

echo "==> Deploying action log (reputation=$REPUTATION)"
ACTION_LOG=$(stellar contract deploy --wasm "$LOG_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --reputation "$REPUTATION")
echo "    action_log = $ACTION_LOG"

echo "==> Authorizing the action log as the reputation's logger"
stellar contract invoke --id "$REPUTATION" \
  --source "$SOURCE" --network "$NETWORK" -- set_logger --logger "$ACTION_LOG"

echo
echo "Deployed and wired on $NETWORK:"
echo "  reputation = $REPUTATION"
echo "  action_log = $ACTION_LOG"
echo
echo "Paste these into src/config/contract.ts."
