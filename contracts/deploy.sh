#!/usr/bin/env bash
#
# Zentra five-contract deployment workflow.
# Builds, deploys, and wires the Reputation, Action Log, Feedback, Proof
# Registry, and MultiSig contracts, then prints the ids to paste into
# src/config/contract.ts.
#
# Usage:  SOURCE=zentra-deployer ./contracts/deploy.sh
#
# Env:
#   NETWORK             target network (default: testnet). Anything else
#                       demands a typed "mainnet" confirmation on stdin.
#   SOURCE              key that signs the deploys (default: zentra-deployer)
#   ADMIN               address recorded as the reputation admin
#                       (default: SOURCE's address)
#   ADMIN_SIGNER        key that signs set_logger (default: SOURCE, see below)
#   MULTISIG_SIGNERS    comma-separated signer addresses, no spaces
#                       (default: ADMIN)
#   MULTISIG_THRESHOLD  approvals required to execute (default: 1)
#
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
SOURCE="${SOURCE:-zentra-deployer}"
ADMIN="${ADMIN:-$(stellar keys address "$SOURCE")}"

# The key that SIGNS the set_logger call, as opposed to the address recorded as
# admin. Reputation::set_logger calls admin.require_auth(), so this must be the
# admin's key, not the deployer's.
#
# They are the same account by default, which is why this has never mattered on
# testnet. The moment ADMIN is set to a separately-custodied account -- exactly
# what docs/MAINNET.md tells you to do -- signing with SOURCE fails the auth
# check. Set ADMIN_SIGNER to the admin's configured key in that case.
ADMIN_SIGNER="${ADMIN_SIGNER:-$SOURCE}"

MULTISIG_SIGNERS="${MULTISIG_SIGNERS:-$ADMIN}"
MULTISIG_THRESHOLD="${MULTISIG_THRESHOLD:-1}"

# Deploying anywhere but testnet is a real-money, real-users action. Demand a
# typed confirmation on stdin rather than a flag, so a stray env var or a
# copy-pasted command line cannot reach mainnet on its own.
if [ "$NETWORK" != "testnet" ]; then
  echo "!! NETWORK is '$NETWORK', not testnet."
  echo "!! This deploys all five contracts for real. Type 'mainnet' to continue."
  printf "> "
  read -r confirm
  if [ "$confirm" != "mainnet" ]; then
    echo "Aborted: expected the literal word 'mainnet'."
    exit 1
  fi
fi

cd "$(dirname "$0")"

echo "==> Building contracts"
( cd zentra-reputation && stellar contract build )
( cd zentra-action-log && stellar contract build )
( cd zentra-feedback && stellar contract build )
( cd zentra-proof-registry && stellar contract build )
( cd zentra-multisig && stellar contract build )

# The cargo workspace shares one target dir at contracts/target.
REP_WASM="target/wasm32v1-none/release/zentra_reputation.wasm"
LOG_WASM="target/wasm32v1-none/release/zentra_action_log.wasm"
FBK_WASM="target/wasm32v1-none/release/zentra_feedback.wasm"
PRF_WASM="target/wasm32v1-none/release/zentra_proof_registry.wasm"
MSG_WASM="target/wasm32v1-none/release/zentra_multisig.wasm"

echo "==> Deploying reputation (admin=$ADMIN)"
REPUTATION=$(stellar contract deploy --wasm "$REP_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --admin "$ADMIN")
echo "    reputation = $REPUTATION"

echo "==> Deploying action log (reputation=$REPUTATION)"
ACTION_LOG=$(stellar contract deploy --wasm "$LOG_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- --reputation "$REPUTATION")
echo "    action_log = $ACTION_LOG"

echo "==> Deploying feedback (no constructor)"
FEEDBACK=$(stellar contract deploy --wasm "$FBK_WASM" \
  --source "$SOURCE" --network "$NETWORK")
echo "    feedback = $FEEDBACK"

echo "==> Deploying proof registry (no constructor)"
PROOF_REGISTRY=$(stellar contract deploy --wasm "$PRF_WASM" \
  --source "$SOURCE" --network "$NETWORK")
echo "    proof_registry = $PROOF_REGISTRY"

# MultiSig::__constructor takes Vec<Address> + u32; the CLI wants the vector as
# a JSON array, so wrap the comma-separated MULTISIG_SIGNERS accordingly.
SIGNERS_JSON="[\"${MULTISIG_SIGNERS//,/\",\"}\"]"

echo "==> Deploying multisig (signers=$SIGNERS_JSON threshold=$MULTISIG_THRESHOLD)"
MULTISIG=$(stellar contract deploy --wasm "$MSG_WASM" \
  --source "$SOURCE" --network "$NETWORK" -- \
  --signers "$SIGNERS_JSON" --threshold "$MULTISIG_THRESHOLD")
echo "    multisig = $MULTISIG"

echo "==> Authorizing the action log as the reputation's logger (signed by admin=$ADMIN)"
stellar contract invoke --id "$REPUTATION" \
  --source "$ADMIN_SIGNER" --network "$NETWORK" -- set_logger --logger "$ACTION_LOG"

echo
echo "Deployed and wired on $NETWORK."
echo
echo "Paste into the DEPLOYMENTS entry in src/config/contract.ts (keep the"
echo "existing deployLedger and readSource unless this is a fresh network):"
echo
echo "    contractId: '$ACTION_LOG',"
echo "    reputationId: '$REPUTATION',"
echo "    feedbackId: '$FEEDBACK',"
echo "    proofRegistryId: '$PROOF_REGISTRY',"
echo
echo "multisig (no ContractSet field yet -- keep with the deploy records):"
echo "  multisig = $MULTISIG"
