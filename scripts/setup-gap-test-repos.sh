#!/usr/bin/env bash
# Clones the SAiST gap test corpora into /tmp/saist-gap-test/.
# Re-running is safe — existing directories are skipped.
set -euo pipefail

BASE="/tmp/saist-gap-test"
mkdir -p "$BASE"

clone_full() {
  local lang="$1" repo="$2" branch="$3"
  local dest="$BASE/$lang"
  if [ -d "$dest" ]; then echo "[$lang] already exists, skipping"; return; fi
  git clone --depth=1 --branch "$branch" "$repo" "$dest"
}

clone_sparse() {
  local lang="$1" repo="$2" branch="$3"
  shift 3
  local dest="$BASE/$lang"
  if [ -d "$dest" ]; then echo "[$lang] already exists, skipping"; return; fi
  git clone --depth=1 --branch "$branch" --no-checkout --filter=blob:none "$repo" "$dest"
  git -C "$dest" sparse-checkout init --cone
  git -C "$dest" sparse-checkout set "$@"
  git -C "$dest" checkout
}

# Full clones
clone_full rust       https://github.com/dtolnay/anyhow                master
clone_full go         https://github.com/go-chi/chi                    master
clone_full python     https://github.com/pallets/itsdangerous           main
clone_full compact    https://github.com/OpenZeppelin/compact-contracts main
clone_full noir       https://github.com/noir-lang/noir-examples        master
clone_full tolk       https://github.com/ton-blockchain/tolk-bench      master
clone_full cpp        https://github.com/dropbox/json11                 master
clone_full java       https://github.com/NanoHttpd/nanohttpd            master
clone_full javascript https://github.com/expressjs/express.git          master
clone_full typescript https://github.com/colinhacks/zod.git             main
clone_full tsx        https://github.com/alampros/react-confetti        develop
clone_full flow       https://github.com/facebook/flux                  main

# Sparse clones (large repos — only the relevant subdirectory)
clone_sparse solidity https://github.com/Uniswap/v2-core master \
  contracts

clone_sparse cairo https://github.com/OpenZeppelin/cairo-contracts main \
  packages/interfaces/src/token \
  packages/token/src/erc20

clone_sparse move https://github.com/aptos-labs/aptos-core main \
  aptos-move/framework/aptos-framework/sources

clone_sparse masm https://github.com/0xPolygonMiden/miden-vm next \
  crates/lib/core/asm

echo ""
echo "Done. Corpora available under $BASE/"
