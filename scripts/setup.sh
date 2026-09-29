#!/usr/bin/env bash
# One-time setup for your own copy of Mirah. Run from the repo root:
#   bash scripts/setup.sh
# Works in Git Bash (Windows), macOS and Linux. Needs: gcloud, node. Optional: vercel.
# Safe to re-run: existing secrets in .env.local are kept, so stored inbox tokens stay readable.
set -euo pipefail

cd "$(dirname "$0")/.."

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ask VAR "Prompt" [default]: reads into VAR, falling back to the default on empty input.
ask() {
  local reply
  if [ -n "${3:-}" ]; then read -r -p "  $2 [$3]: " reply; else read -r -p "  $2: " reply; fi
  printf -v "$1" '%s' "${reply:-${3:-}}"
}

# ask_secret VAR "Prompt" [current]: hidden input; empty keeps the current value.
ask_secret() {
  local reply hint=""
  [ -n "${3:-}" ] && hint=" (Enter keeps current)"
  read -r -s -p "  $2$hint: " reply
  echo
  printf -v "$1" '%s' "${reply:-${3:-}}"
}

# Value of NAME in .env.local, if the file exists.
existing() {
  [ -f .env.local ] || return 0
  grep -E "^$1=" .env.local | tail -1 | cut -d= -f2- || true
}

random_secret() { node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"; }

command -v gcloud >/dev/null || die "gcloud isn't installed. Get it from https://cloud.google.com/sdk/docs/install"
command -v node >/dev/null || die "node isn't installed. Get it from https://nodejs.org"

bold "Mirah setup"
note "This sets up your own private copy: your database, your Google sign-in, your Jev key."
note "Nothing is shared with anyone else's Mirah."

# ---------- Where it runs ----------
bold "1. Where will Mirah run?"
note "1) Vercel      (easiest; free Hobby plan)"
note "2) Cloud Run   (Google Cloud; free tier)"
note "3) Only on this computer for now"
ask TARGET "Choose 1, 2 or 3" "1"
case "$TARGET" in 1 | 2 | 3) ;; *) die "Please choose 1, 2 or 3." ;; esac

# ---------- Google Cloud project + Firestore ----------
bold "2. Google Cloud project"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  gcloud auth login
fi
ask PROJECT "Project ID (created if it doesn't exist; must be globally unique)" "$(existing GOOGLE_CLOUD_PROJECT)"
[ -n "$PROJECT" ] || die "A project ID is required."
if ! gcloud projects describe "$PROJECT" >/dev/null 2>&1; then
  gcloud projects create "$PROJECT" --name="Mirah"
fi
gcloud config set project "$PROJECT" >/dev/null

APIS="firestore.googleapis.com gmail.googleapis.com"
if [ "$TARGET" = 2 ]; then
  APIS="$APIS run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com"
  note "Cloud Run needs a billing account linked (usage stays in the free tier):"
  note "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  note "Set a \$1 budget alert while you're there."
  read -r -p "  Press Enter once billing is linked. " _
fi
note "Enabling APIs (takes a minute)..."
# shellcheck disable=SC2086
gcloud services enable $APIS

ask REGION "Region" "us-central1"
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION"
fi
gcloud firestore indexes composite create --collection-group=emails \
  --field-config=field-path=bucket,order=ascending \
  --field-config=field-path=receivedAt,order=descending --async >/dev/null 2>&1 ||
  note "Inbox index already exists."

# ---------- App URL ----------
APP_URL=""
if [ "$TARGET" = 1 ]; then
  command -v vercel >/dev/null || die "Install the Vercel CLI first: npm i -g vercel"
  bold "3. Vercel project"
  [ -f .vercel/project.json ] || vercel link
  VERCEL_NAME=$(node -e "process.stdout.write(require('./.vercel/project.json').projectName||'')")
  ask APP_URL "Production URL" "https://$VERCEL_NAME.vercel.app"
  APP_URL="${APP_URL%/}"
fi

# ---------- Sign-in + Gmail access ----------
bold "4. Google sign-in (OAuth client)"
note "Google doesn't let scripts create this part, so it's a few clicks:"
note "  a. Open https://console.cloud.google.com/auth/overview?project=$PROJECT and click Get started."
note "     App name: Mirah. Audience: External. Add your Gmail address as a test user."
note "  b. Data access → Add scopes: openid, .../auth/userinfo.email, .../auth/gmail.modify"
note "  c. Audience → Publish app. (Otherwise Google disconnects Gmail every 7 days.)"
note "  d. Clients → Create client → Web application. Authorized redirect URIs:"
note "       http://localhost:3000/api/auth/google/callback"
if [ -n "$APP_URL" ]; then
  note "       $APP_URL/api/auth/google/callback"
else
  [ "$TARGET" != 2 ] || note "       (the Cloud Run one is printed at the end; add it then)"
fi
ask GOOGLE_CLIENT_ID "Client ID" "$(existing GOOGLE_CLIENT_ID)"
ask_secret GOOGLE_CLIENT_SECRET "Client secret" "$(existing GOOGLE_CLIENT_SECRET)"

bold "5. You and your Jev key"
ask ALLOWED_EMAILS "Google address(es) allowed to sign in, comma-separated" "$(existing ALLOWED_EMAILS)"
note "Get a Jev key at https://docs.typesafe.ai/api"
ask_secret JEV_API_KEY "Jev API key" "$(existing JEV_API_KEY)"

bold "6. Outlook (optional; Enter to skip)"
note "Guide: 'Outlook' section of SETUP.md."
ask MS_CLIENT_ID "Microsoft client ID" "$(existing MS_CLIENT_ID)"
MS_CLIENT_SECRET=""
[ -z "$MS_CLIENT_ID" ] || ask_secret MS_CLIENT_SECRET "Microsoft client secret" "$(existing MS_CLIENT_SECRET)"

SESSION_SECRET=$(existing SESSION_SECRET); SESSION_SECRET=${SESSION_SECRET:-$(random_secret)}
TOKEN_ENCRYPTION_KEY=$(existing TOKEN_ENCRYPTION_KEY); TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY:-$(random_secret)}
CRON_SECRET=$(existing CRON_SECRET); CRON_SECRET=${CRON_SECRET:-$(random_secret)}

VARS="ALLOWED_EMAILS GOOGLE_CLOUD_PROJECT SESSION_SECRET TOKEN_ENCRYPTION_KEY CRON_SECRET JEV_API_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MS_CLIENT_ID MS_CLIENT_SECRET"
GOOGLE_CLOUD_PROJECT="$PROJECT"

# ---------- Local env file ----------
[ ! -f .env.local ] || cp .env.local .env.local.bak
{
  echo "# Written by scripts/setup.sh. Keep this file private."
  echo "APP_URL=http://localhost:3000"
  for v in $VARS; do echo "$v=${!v}"; done
} >.env.local
note "Wrote .env.local (previous copy saved as .env.local.bak)."

# ---------- Deploy ----------
if [ "$TARGET" = 1 ]; then
  bold "7. Deploying to Vercel"
  # Vercel isn't on Google Cloud, so it reaches Firestore with its own service account key.
  SA="mirah-app@$PROJECT.iam.gserviceaccount.com"
  gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 ||
    gcloud iam service-accounts create mirah-app --display-name="Mirah app"
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
    --role=roles/datastore.user --condition=None >/dev/null
  KEY_FILE=$(mktemp)
  gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA" >/dev/null
  GOOGLE_SERVICE_ACCOUNT_JSON=$(node -e "process.stdout.write(require('fs').readFileSync(process.argv[1]).toString('base64'))" "$KEY_FILE")
  rm -f "$KEY_FILE"

  for v in APP_URL $VARS GOOGLE_SERVICE_ACCOUNT_JSON; do
    [ -n "${!v}" ] || continue
    vercel env rm "$v" production -y >/dev/null 2>&1 || true
    printf '%s' "${!v}" | vercel env add "$v" production >/dev/null
    note "set $v"
  done
  vercel deploy --prod
elif [ "$TARGET" = 2 ]; then
  bold "7. Deploying to Cloud Run (first build takes a few minutes)"
  {
    echo "APP_URL: \"https://placeholder.invalid\""
    for v in $VARS; do if [ -n "${!v}" ]; then echo "$v: \"${!v}\""; fi; done
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
fi

# ---------- Background sync ----------
if [ "$TARGET" != 3 ]; then
  bold "8. Background sync"
  note "Mirah sorts new mail whenever you open it. To also sort in the background every 5 minutes,"
  note "Cloud Scheduler can call it (free for up to 3 jobs, but needs billing linked)."
  ask SCHEDULE "Set up background sync? (y/n)" "$([ "$TARGET" = 2 ] && echo y || echo n)"
  if [ "$SCHEDULE" = y ]; then
    gcloud services enable cloudscheduler.googleapis.com
    JOB_ARGS=(--location "$REGION" --schedule "*/5 * * * *" --http-method POST
      --uri "$APP_URL/api/cron/sync" --headers "x-cron-secret=$CRON_SECRET" --attempt-deadline 300s)
    gcloud scheduler jobs create http mirah-sync "${JOB_ARGS[@]}" 2>/dev/null ||
      gcloud scheduler jobs update http mirah-sync "${JOB_ARGS[@]}"
  fi
fi

# ---------- Done ----------
bold "Done"
if [ "$TARGET" = 3 ]; then
  note "Run: gcloud auth application-default login && npm install && npm run dev"
  note "Then open http://localhost:3000"
else
  [ "$TARGET" != 2 ] || note "Add this redirect URI to your Google OAuth client: $APP_URL/api/auth/google/callback"
  [ -z "$MS_CLIENT_ID" ] || note "Add this redirect URI to your Microsoft app: $APP_URL/api/auth/microsoft/callback"
  note "Open $APP_URL/setup to check everything, then sign in."
  note "On your phone: open $APP_URL, then Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android)."
fi
