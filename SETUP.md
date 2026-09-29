# Setting up Mirah

**The quick way:** run `bash scripts/setup.sh`. On Windows, run it in **Git Bash** (Start menu → Git Bash), not PowerShell. It does everything below and walks you through the one manual step, the OAuth client.
This page is the manual version, and it's useful for troubleshooting.

About 30–45 minutes, done once. Everything stays inside Google Cloud's free tier at personal volume.
The commands use Git Bash. In PowerShell, swap `\` line continuations for backticks.

## 1. Google Cloud project

```bash
gcloud auth login
gcloud projects create mirah-inbox-123 --name="Mirah"   # pick a unique id
gcloud config set project mirah-inbox-123
```

Cloud Run needs a billing account linked, even though usage stays within the free tier.
Link one at https://console.cloud.google.com/billing and set a **budget alert at $1**, so you'd hear about any surprise.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com cloudscheduler.googleapis.com gmail.googleapis.com

# The free tier applies to the database named "(default)"
gcloud firestore databases create --location=us-central1

# Index for the inbox feed (bucket + newest first)
gcloud firestore indexes composite create --collection-group=emails \
  --field-config=field-path=bucket,order=ascending \
  --field-config=field-path=receivedAt,order=descending
```

## 2. Google sign-in + Gmail access (OAuth)

In the console: **APIs & Services → OAuth consent screen** (now called "Google Auth Platform"):

1. **Audience:** External. Add your own Gmail address(es) as test users.
2. **Data access:** add the scopes `openid`, `.../auth/userinfo.email`, `.../auth/gmail.modify`.
3. **Audience → Publish app** ("In production"). *This matters.* While the app stays in "Testing",
   Google expires your Gmail connection every 7 days. Once published, you click through a
   "Google hasn't verified this app" warning once, and the connection lasts. Unverified apps are
   capped at 100 users, which is fine for personal use.

Then **Clients → Create client → Web application**, with these authorized redirect URIs:
- `http://localhost:3000/api/auth/google/callback`
- `https://<your Cloud Run URL>/api/auth/google/callback`. You add this one after step 6.

Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## 3. Outlook (optional)

At https://entra.microsoft.com → **App registrations → New registration**:
- Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
- Redirect URI (Web): `http://localhost:3000/api/auth/microsoft/callback`. Add the Cloud Run one later.
- **Certificates & secrets → New client secret.** Copy the *Value*. It expires, up to 24 months, so note the date.
- **API permissions → Microsoft Graph → Delegated:** `Mail.ReadWrite`, `User.Read`, `offline_access`, `openid`, `email`.

Copy the Application (client) ID and the secret into `MS_CLIENT_ID` and `MS_CLIENT_SECRET`.

## 4. Jev

Get an API key from TypeSafe and put it in `JEV_API_KEY`.

## 5. Run locally

```bash
cp .env.example .env.local        # fill it in
node -e "for (const n of ['SESSION_SECRET','TOKEN_ENCRYPTION_KEY','CRON_SECRET']) console.log(n+'='+require('crypto').randomBytes(32).toString('base64'))"
gcloud auth application-default login   # lets the local app reach Firestore
npm install
npm run dev
```

Then:
1. Open http://localhost:3000 and sign in.
2. Go to **Settings → Connect Gmail / Connect Outlook**.
3. Under **Backfill**, run it for the last 14 days.
4. Review the sorted emails with **✓ Correct / → Important / → Review / → Junk**, and watch the **Accuracy** page.

To trigger a scheduled-style sync by hand:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/sync
```

## 6. Deploy to Cloud Run

```bash
cp env.example.yaml env.yaml      # same secrets as .env.local; APP_URL filled in below

gcloud run deploy mirah --source . --region us-central1 \
  --allow-unauthenticated --memory 512Mi --max-instances 1 --timeout 300 \
  --env-vars-file env.yaml
```

The first deploy prints the service URL. Then:
1. Put that URL in `APP_URL` in `env.yaml`.
2. Redeploy by running the same command again.
3. Add the URL's `/api/auth/google/callback` and `/api/auth/microsoft/callback` as redirect URIs in steps 2 and 3.

`--allow-unauthenticated` only makes the site reachable. Every page still requires signing in with an
address in `ALLOWED_EMAILS`, and the sync endpoint requires the cron secret.

Give the service permission to use Firestore:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get project) --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $(gcloud config get project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" --role=roles/datastore.user
```

## 7. Schedule the sync

```bash
gcloud scheduler jobs create http mirah-sync --location us-central1 \
  --schedule "*/5 * * * *" --http-method POST \
  --uri "https://<your Cloud Run URL>/api/cron/sync" \
  --headers "x-cron-secret=<CRON_SECRET>" --attempt-deadline 300s
```

Every 5 minutes fits comfortably in the free tier (3 free Scheduler jobs, and Cloud Run's monthly free CPU).
Checking every 2 minutes also works, but uses more of the free Cloud Run allowance.

## 8. Install on your phone

Open the Cloud Run URL on your phone:
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Install app**

## Keeping it free

- Firestore free tier: 50k reads, 20k writes and 1 GiB per day. Each inbox view costs about 50 reads.
- Every deploy stores a container image in Artifact Registry. Free storage is 0.5 GB, so delete old images occasionally,
  or add a cleanup policy to the `cloud-run-source-deploy` repository.
