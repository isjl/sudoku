#!/usr/bin/env bash
# Deploy public/ to https://longkutoy.com/sudoku-puzzle/
#
#   ./deploy.sh            upload changes
#   ./deploy.sh --dryrun   show what would change, upload nothing
#
# Override defaults with env vars: BUCKET, PREFIX, DOMAIN, AWS_PROFILE.
set -euo pipefail
cd "$(dirname "$0")"

BUCKET="${BUCKET:-longkutoy.com}"
PREFIX="${PREFIX:-sudoku-puzzle}"
DOMAIN="${DOMAIN:-longkutoy.com}"
DRYRUN=()
[[ "${1:-}" == "--dryrun" ]] && DRYRUN=(--dryrun)

# Fail fast with a clear message if credentials are broken.
aws sts get-caller-identity --query Account --output text >/dev/null

# --delete only touches objects under $PREFIX/, never the rest of the site.
# no-cache = browsers revalidate (cheap 304s), so new versions show up immediately.
aws s3 sync public/ "s3://$BUCKET/$PREFIX/" \
  --delete \
  --exclude ".*" --exclude "*/.*" \
  --cache-control "no-cache" \
  ${DRYRUN[@]+"${DRYRUN[@]}"}

# If the site sits behind CloudFront, invalidate this app's paths.
if [[ ${#DRYRUN[@]} -eq 0 ]]; then
  DIST_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$DOMAIN')].Id | [0]" \
    --output text 2>/dev/null || true)
  if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
    aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
      --paths "/$PREFIX" "/$PREFIX/*" --query Invalidation.Id --output text
    echo "CloudFront invalidation started on $DIST_ID"
  fi
fi

if [[ ${#DRYRUN[@]} -eq 0 ]]; then echo "Deployed → https://$DOMAIN/$PREFIX/"; else echo "Dry run only — nothing uploaded."; fi
