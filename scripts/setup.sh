#!/usr/bin/env bash
# One-time setup for your own copy of Mirah. Run from the repo root:
#   bash scripts/setup.sh
# Works in Git Bash (Windows), macOS and Linux. Needs: gcloud, node. For Vercel, also the vercel CLI.
# It handles the cloud side. Your keys (Google sign-in, Jev) are entered afterwards in the browser, at /setup.
# Safe to re-run: every step skips what already exists, and secrets in .env.local are kept,
# so stored inbox tokens stay readable.
set -Eeuo pipefail

cd "$(dirname "$0")/.."

# Never stop silently: say where it failed and that re-running picks up where it left off.
trap 'printf "\n\033[31mSetup stopped unexpectedly (line %s). Nothing is lost: run  bash scripts/setup.sh  again to continue.\033[0m\n" "$LINENO" >&2' ERR

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# Drops anything already waiting on the terminal. Some interactive CLIs (Vercel's, in Git Bash) leave
# screen text behind as input, which would otherwise silently answer the next question.
flush_input() { while read -r -t 0.1 _ 2>/dev/null; do :; done; }

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  printf '%s' "${s%"${s##*[![:space:]]}"}"
}

# ask VAR "Prompt" [default] [regex] [hint]: asks until the answer (or the default) matches the regex.
ask() {
  local reply hint="${5:-}"
  [ -n "$hint" ] || hint="That doesn't look right. Try again."
  while :; do
    flush_input
    if [ -n "${3:-}" ]; then read -r -p "  $2 [$3]: " reply; else read -r -p "  $2: " reply; fi
    reply=$(trim "${reply:-${3:-}}")
    if [ -z "${4:-}" ] || [[ "$reply" =~ $4 ]]; then break; fi
    warn "$hint"
  done
  printf -v "$1" '%s' "$reply"
}

# Value of NAME in .env.local, if the file exists.
existing() {
  [ -f .env.local ] || return 0
  grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- || true
}

random_secret() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"; }

RE_PROJECT='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
RE_URL='^https://[^[:space:]/]+$'
RE_YN='^[yn]$'

command -v gcloud >/dev/null || die "gcloud isn't installed. Get it from https://cloud.google.com/sdk/docs/install"
command -v node >/dev/null || die "node isn't installed. Get it from https://nodejs.org"

bold "Mirah setup"
note "This creates your own private copy of Mirah: its database, server and secrets."
note "Then you'll finish in the browser: Google sign-in and your Jev key."
note "When a question shows a value in [brackets], press Enter to accept it."
note "Wait for each question before typing; anything typed early is ignored."

# ---------- Where it runs ----------
bold "1. Where will Mirah run?"
note "1) Vercel      (easiest; free Hobby plan)"
note "2) Cloud Run   (Google Cloud; free tier, needs billing linked)"
note "3) Only on this computer for now"
ask TARGET "Choose 1, 2 or 3" "1" '^[123]$' "Type 1, 2 or 3."
# Check tools and logins now, not halfway through.
if [ "$TARGET" = 1 ]; then
  command -v vercel >/dev/null || die "The Vercel option needs the Vercel CLI. Run: npm i -g vercel  then run this script again."
  vercel whoami >/dev/null 2>&1 || vercel login
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  gcloud auth login
fi

# ---------- Google Cloud project + Firestore ----------
bold "2. Google Cloud project"
# Only suggest a project an earlier run in this same folder chose (saved to .env.local right below).
note "A new ID makes a new project, e.g. mirah-yourname-123. Must be unique across all of Google Cloud."
ask PROJECT "Project ID" "$(existing GOOGLE_CLOUD_PROJECT)" "$RE_PROJECT" \
  "6–30 characters: lowercase letters, numbers and dashes, starting with a letter."
if ! grep -q "^GOOGLE_CLOUD_PROJECT=" .env.local 2>/dev/null; then
  echo "GOOGLE_CLOUD_PROJECT=$PROJECT" >>.env.local
fi
if ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  note "Creating project $PROJECT..."
  # gcloud prints harmless advice here (environment tags, component updates); show output only on failure.
  if ! OUT=$(gcloud projects create "$PROJECT" --name="Mirah" 2>&1); then
    echo "$OUT"
    die "Couldn't create $PROJECT. If the ID is taken, run the script again with another."
  fi
fi
gcloud config set project "$PROJECT" >/dev/null 2>&1

APIS="firestore.googleapis.com gmail.googleapis.com"
if [ "$TARGET" = 2 ]; then
  APIS="$APIS run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com"
  note "Cloud Run needs a billing account linked (usage stays in the free tier):"
  note "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  note "Set a \$1 budget alert while you're there."
  flush_input
  read -r -p "  Press Enter once billing is linked. " _
fi
note "Enabling APIs (takes a minute)..."
# shellcheck disable=SC2086
if ! OUT=$(gcloud services enable $APIS 2>&1); then
  echo "$OUT"
  die "Couldn't enable the Google Cloud APIs."
fi

if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  REGION=$(gcloud firestore databases describe --database='(default)' --format='value(locationId)')
  note "Database already exists in $REGION."
else
  note "Where your database lives. Press Enter for the default; it can't be changed later."
  ask REGION "Region" "us-central1" '^[a-z]+-[a-z]+[0-9]+$' "Use a region name like us-central1 or europe-west1."
  note "Creating database..."
  gcloud firestore databases create --location="$REGION" >/dev/null 2>&1 ||
    die "Couldn't create the database. Run: gcloud firestore databases create --location=$REGION  to see why."
fi
gcloud firestore indexes composite create --collection-group=emails \
  --field-config=field-path=bucket,order=ascending \
  --field-config=field-path=receivedAt,order=descending --async >/dev/null 2>&1 || true

# ---------- Vercel project ----------
APP_URL=""
if [ "$TARGET" = 1 ]; then
  bold "3. Vercel project"
  if [ ! -f .vercel/project.json ]; then
    ask VERCEL_NAME "Name for your Vercel project" "mirah" '^[a-z0-9][a-z0-9-]{0,99}$' \
      "Lowercase letters, numbers and dashes only."
    if ! vercel project add "$VERCEL_NAME" </dev/null >/dev/null 2>&1; then
      ask REUSE "You already have a Vercel project named $VERCEL_NAME. Its settings would be replaced. Use it anyway? (y/n)" \
        "n" "$RE_YN" "Type y or n."
      [ "$REUSE" = y ] || die "Run the script again and pick a different name."
    fi
    vercel link --yes --project "$VERCEL_NAME" </dev/null >/dev/null 2>&1 ||
      die "Couldn't link the Vercel project. Try: vercel link --project $VERCEL_NAME"
  fi
fi

# ---------- Server secrets (generated; re-runs keep them so stored tokens stay readable) ----------
SESSION_SECRET=$(existing SESSION_SECRET); SESSION_SECRET=${SESSION_SECRET:-$(random_secret)}
TOKEN_ENCRYPTION_KEY=$(existing TOKEN_ENCRYPTION_KEY); TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY:-$(random_secret)}
CRON_SECRET=$(existing CRON_SECRET); CRON_SECRET=${CRON_SECRET:-$(random_secret)}
GOOGLE_SERVICE_ACCOUNT_JSON=$(existing GOOGLE_SERVICE_ACCOUNT_JSON)
GOOGLE_CLOUD_PROJECT="$PROJECT"
VARS="GOOGLE_CLOUD_PROJECT SESSION_SECRET TOKEN_ENCRYPTION_KEY CRON_SECRET"
# Entered in the browser now. Old copies of these as environment variables would override the wizard.
LEGACY_VARS="APP_URL ALLOWED_EMAILS JEV_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MS_CLIENT_ID MS_CLIENT_SECRET"

write_env_local() {
  {
    echo "# Written by scripts/setup.sh. Keep this file private."
    echo "# Google sign-in, Jev and Outlook keys are entered at /setup in the browser, not here."
    echo "APP_URL=http://localhost:3000"
    for v in $VARS GOOGLE_SERVICE_ACCOUNT_JSON; do echo "$v=${!v}"; done
  } >.env.local
}
[ ! -f .env.local ] || cp .env.local .env.local.bak
write_env_local

# ---------- Deploy ----------
if [ "$TARGET" = 1 ]; then
  bold "4. Deploying to Vercel"
  # Vercel isn't on Google Cloud, so it reaches Firestore with its own service account key.
  # The key is kept in .env.local so re-runs reuse it instead of piling up new keys.
  if [ -z "$GOOGLE_SERVICE_ACCOUNT_JSON" ]; then
    SA="mirah-app@$PROJECT.iam.gserviceaccount.com"
    gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
      gcloud iam service-accounts create mirah-app --display-name="Mirah app" >/dev/null 2>&1
    # A brand-new service account takes a few seconds to become visible to IAM, so retry the grant.
    for attempt in 1 2 3 4 5 6; do
      if OUT=$(gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
        --role=roles/datastore.user --condition=None 2>&1); then
        break
      fi
      [ "$attempt" -lt 6 ] || { echo "$OUT"; die "Couldn't give Mirah access to its database."; }
      sleep 5
    done
    KEY_FILE=$(mktemp)
    gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA" >/dev/null 2>&1 ||
      die "Couldn't create a database key. Some Google accounts (work/school) block this; use the Cloud Run option instead."
    GOOGLE_SERVICE_ACCOUNT_JSON=$(node -e "process.stdout.write(require('fs').readFileSync(process.argv[1]).toString('base64'))" "$KEY_FILE")
    rm -f "$KEY_FILE"
    write_env_local
  fi

  note "Saving server settings to Vercel..."
  for v in $LEGACY_VARS; do vercel env rm "$v" production -y </dev/null >/dev/null 2>&1 || true; done
  for v in $VARS GOOGLE_SERVICE_ACCOUNT_JSON; do
    vercel env rm "$v" production -y </dev/null >/dev/null 2>&1 || true
    printf '%s' "${!v}" | vercel env add "$v" production >/dev/null 2>&1 || die "Couldn't save $v to Vercel."
  done
  note "Deploying (about a minute)..."
  DEPLOY_OUT=$(vercel deploy --prod --yes </dev/null 2>&1) || { echo "$DEPLOY_OUT"; die "The Vercel deploy failed."; }
  DETECTED=$(printf '%s\n' "$DEPLOY_OUT" | grep -i 'aliased' | grep -o 'https://[^[:space:]]*' | head -1 || true)
  ask APP_URL "Your site's address" "${DETECTED%/}" "$RE_URL" "Enter the https:// address of your site, with no path."
elif [ "$TARGET" = 2 ]; then
  bold "4. Deploying to Cloud Run (first build takes a few minutes)"
  {
    echo "APP_URL: \"https://placeholder.invalid\""
    for v in $VARS; do echo "$v: \"${!v}\""; done
  } >env.yaml
  gcloud run deploy mirah --source . --region "$REGION" --allow-unauthenticated \
    --memory 512Mi --max-instances 1 --timeout 300 --env-vars-file env.yaml
  APP_URL=$(gcloud run services describe mirah --region "$REGION" --format='value(status.url)')
  sed -i.bak "s#^APP_URL: .*#APP_URL: \"$APP_URL\"#" env.yaml && rm -f env.yaml.bak
  gcloud run services update mirah --region "$REGION" --update-env-vars "APP_URL=$APP_URL" >/dev/null
  PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role=roles/datastore.user --condition=None >/dev/null
else
  APP_URL="http://localhost:3000"
fi

# ---------- Reachability ----------
if [ "$TARGET" != 3 ] && command -v curl >/dev/null; then
  while :; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/setup" || true)
    [ "$CODE" = 401 ] || [ "$CODE" = 403 ] || break
    warn "Vercel's Deployment Protection is blocking your site, so your phone and background sync can't reach it."
    note "Turn it off: vercel.com → your project → Settings → Deployment Protection → Vercel Authentication → Disabled → Save."
    note "(Mirah has its own sign-in, so the site stays private.)"
    flush_input
    read -r -p "  Press Enter once it's off. " _
  done
fi

# ---------- Background sync ----------
if [ "$TARGET" != 3 ]; then
  bold "5. Background sync"
  note "Mirah sorts new mail whenever you open it. To also sort in the background every 5 minutes,"
  note "Cloud Scheduler can call it (free for up to 3 jobs, but needs billing linked)."
  ask SCHEDULE "Set up background sync? (y/n)" "$([ "$TARGET" = 2 ] && echo y || echo n)" "$RE_YN" "Type y or n."
  if [ "$SCHEDULE" = y ]; then
    gcloud services enable cloudscheduler.googleapis.com >/dev/null 2>&1 ||
      die "Couldn't enable Cloud Scheduler. Link billing at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT and re-run."
    JOB_ARGS=(--location "$REGION" --schedule "*/5 * * * *" --http-method POST
      --uri "$APP_URL/api/cron/sync" --headers "x-cron-secret=$CRON_SECRET" --attempt-deadline 300s)
    gcloud scheduler jobs create http mirah-sync "${JOB_ARGS[@]}" >/dev/null 2>&1 ||
      gcloud scheduler jobs update http mirah-sync "${JOB_ARGS[@]}" >/dev/null
    note "Background sync is on."
  fi
fi

# ---------- Done ----------
# Same derivation as setupKey() in src/lib/config.ts. Only works until someone signs in as the owner.
SETUP_KEY=$(node -e "process.stdout.write(require('crypto').createHmac('sha256', process.argv[1]).update('mirah-setup').digest('base64url').slice(0, 22))" "$SESSION_SECRET")
SETUP_LINK="$APP_URL/setup/unlock?key=$SETUP_KEY"

bold "Almost done: finish in your browser"
if [ "$TARGET" = 3 ]; then
  note "Start Mirah:  gcloud auth application-default login && npm run dev"
  note "Then open:    $SETUP_LINK"
else
  if command -v curl >/dev/null && ! curl -s "$APP_URL/setup" | grep -q "Almost there\|Set up your Mirah\|Mirah is set up"; then
    warn "Your site didn't answer as expected. If the link below shows an error, it will say what's missing."
  fi
  note "Open this link:  $SETUP_LINK"
fi
note "It walks you through Google sign-in and your Jev key, then connects Gmail."
note "Keep the link private until you finish: whoever uses it first becomes the owner."
