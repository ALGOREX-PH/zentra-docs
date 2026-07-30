#!/usr/bin/env bash
#
# Deploy a THROWAWAY reputation + action-log pair for one load run.
#
# This is contracts/deploy.sh with a different purpose and one inverted
# instruction: that script ends by telling you to paste the ids into
# src/config/contract.ts, and this one exists precisely so you do not. A load run
# writes hundreds of synthetic authors into whatever instance it points at, and
# /metrics derives the action count and the distinct-wallet count it presents as
# adoption from the instance named in contract.ts. Those writes cannot be
# subtracted afterwards -- the ledger has no undo -- so the only safe place to
# aim a load run is a pair of contracts nothing else reads.
#
# Each run should get its own pair. They cost testnet lumens, which are free, and
# they are abandoned the moment the run finishes. Do not reuse one across runs
# either: a fresh instance is what makes `get_count` before the run equal to 0,
# which is the only evidence available that the numbers belong to this run alone.
#
# Usage:  SOURCE=zentra-deployer ./scripts/loadtest/deploy-isolated.sh
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-zentra-deployer}"
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"

# The key that SIGNS the set_logger call, as opposed to the address recorded as
# admin. Reputation::set_logger calls admin.require_auth(), so this must be the
# admin's key, not the deployer's. Same subtlety as contracts/deploy.sh: they are
# the same account by default, and only diverge once ADMIN is overridden with a
# separately-custodied account, at which point signing with SOURCE fails the auth
# check. Set ADMIN_SIGNER to the admin's configured key in that case.
ADMIN_SIGNER="${ADMIN_SIGNER:-$SOURCE}"

# A load test on the public network spends real lumens on throwaway accounts that
# no friendbot will fund, and leaves permanent synthetic history behind. There is
# no argument for it, so there is no flag for it.
case "$(printf '%s' "$NETWORK" | tr '[:upper:]' '[:lower:]')" in
  public | mainnet | pubnet)
    echo "refusing to deploy load-test contracts to '$NETWORK'." >&2
    echo "Load runs are testnet-only: they need Friendbot," >&2
    echo "and mainnet history is permanent." >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/../../contracts"

echo "==> Building contracts"
( cd zentra-reputation && stellar contract build )
( cd zentra-action-log && stellar contract build )

REP_WASM="zentra-reputation/target/wasm32v1-none/release/zentra_reputation.wasm"
LOG_WASM="zentra-action-log/target/wasm32v1-none/release/zentra_action_log.wasm"

echo "==> Deploying throwaway reputation (admin=$ADMIN)"
REPUTATION=$(stellar contract deploy --wasm "$REP_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --admin "$ADMIN")
echo "    reputation = $REPUTATION"

echo "==> Deploying throwaway action log (reputation=$REPUTATION)"
ACTION_LOG=$(stellar contract deploy --wasm "$LOG_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --reputation "$REPUTATION")
echo "    action_log = $ACTION_LOG"

# Not optional, and not merely for tidiness. ActionLog::record wraps its
# cross-contract bump in try_bump and degrades to a score of 0 rather than
# trapping (see the ZEN-01 comment in zentra-action-log/src/lib.rs), so an
# unwired pair still records every action -- successfully, with every score 0.
# The run would look fine and would have measured the degraded path instead of
# the cross-contract one, which is the more expensive half of the write.
echo "==> Authorizing the action log as the reputation's logger (signed by admin=$ADMIN)"
stellar contract invoke --id "$REPUTATION" \
  --source "$ADMIN_SIGNER" --network "$NETWORK" -- set_logger --logger "$ACTION_LOG"

echo "==> Verifying the pair"
WIRED=$(stellar contract invoke --id "$ACTION_LOG" \
  --source "$SOURCE" --network "$NETWORK" -- reputation | tr -d '"')
if [ "$WIRED" != "$REPUTATION" ]; then
  echo "    action log points at '$WIRED', not '$REPUTATION'" >&2
  echo "    The wiring is constructor-only and cannot be repaired; redeploy." >&2
  exit 1
fi
echo "    reputation pointer = $WIRED"

# u64 comes back JSON-quoted from the CLI, hence the tr. A non-zero count here
# means this is not a fresh instance, which defeats the entire point of the
# script -- every "how many did this run add" answer would be unattributable.
COUNT=$(stellar contract invoke --id "$ACTION_LOG" \
  --source "$SOURCE" --network "$NETWORK" -- get_count | tr -d '"')
if [ "$COUNT" != "0" ]; then
  echo "    get_count = $COUNT on a contract deployed seconds ago" >&2
  echo "    Something else is writing to it. Do not load test against it." >&2
  exit 1
fi
echo "    get_count = 0 (fresh, as required)"

cat <<EOF

Throwaway pair deployed and wired on $NETWORK:

  reputation = $REPUTATION
  action_log = $ACTION_LOG

---------------------------------------------------------------------------
  DO NOT PASTE THESE INTO src/config/contract.ts.

  They exist for one load run and are abandoned afterwards. The ids in
  contract.ts back the counts /metrics presents as adoption; these ids will
  hold nothing but synthetic accounts that are not users. Swapping them in
  would point the live dApp at an empty contract and would put this run's
  synthetic authors on the page that reports real ones.

  Nothing extends their TTL either: the instance is archived after ~30 quiet
  days and reads against it start failing. That is intended -- a throwaway
  contract is supposed to rot.
---------------------------------------------------------------------------

Run the load test against them:

  bun scripts/loadtest/run.ts \\
    --action-log $ACTION_LOG \\
    --reputation $REPUTATION \\
    --accounts 25 --concurrency 5

Or export them for this shell:

  export LOADTEST_ACTION_LOG_ID=$ACTION_LOG
  export LOADTEST_REPUTATION_ID=$REPUTATION

docs/LOADTEST.md explains how to read what comes back.
EOF
