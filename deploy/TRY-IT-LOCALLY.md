# Trying the app without a server

The quickest way to drive the real app against a real backend: run the stack on
your own machine and expose it through a free Cloudflare quick tunnel, which
hands you an `https://…` address without a domain, a server or a bill.

This is for **testing**. The tunnel dies when you close the terminal and the URL
changes every time you start it — for anything permanent see `DEPLOY.md`.

---

## 1. Docker

Install **Docker Desktop** (Windows / macOS) or `docker.io` + the compose plugin
(Linux), then check it runs:

```bash
docker compose version
```

## 2. The stack

```bash
git clone https://github.com/wessamsamir1-stack/etms.git
cd etms
cp backend/.env.example backend/.env
docker compose -f backend/docker-compose.yml up -d --build
```

**Do not skip the `cp`.** The compose file defaults the API to `NODE_ENV=production`,
and in that mode the boot guards reject the short development secrets — the
container exits before it serves anything. `backend/.env.example` ships
`NODE_ENV=development`, which is what makes the local run legal.

First run pulls PostGIS and builds the image (a few minutes). When it settles:

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"etms-backend","db":"ok",...}
```

The migrate job has already created the schema and seeded a demo company:

| | |
|---|---|
| tenant | `acme` |
| admin | `admin@acme.com` / `Passw0rd!` |
| platform operator | `root@etms.app` / `Platform0wner!` |

For screens with something in them, add the demo day:

```bash
docker compose -f backend/docker-compose.yml exec api node dist/scripts/seed-demo.js
```

## 3. The tunnel

Install `cloudflared` ([docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) — on
Windows `winget install Cloudflare.cloudflared`, on macOS `brew install cloudflared` —
then:

```bash
cloudflared tunnel --url http://localhost:8080
```

It prints something like:

```
Your quick Tunnel has been created! Visit it at:
https://random-three-words.trycloudflare.com
```

Leave that terminal open — closing it takes the tunnel down. Check the address
answers:

```bash
curl https://random-three-words.trycloudflare.com/health
```

## 4. The APK

The app's API address is baked in at build time, so the APK has to be built
against your tunnel URL. Run the **Build APK** workflow with:

| Input | Value |
|---|---|
| `api_base_url` | `https://random-three-words.trycloudflare.com/v1` — note the `/v1` |
| `tenant_slug` | `acme` |

The build takes about seven minutes and attaches `etms-dev.apk` to a new
`apk-dev-<n>` prerelease. Install it, sign in with `admin@acme.com` / `Passw0rd!`,
and the app is talking to the database on your machine.

Restarting the tunnel gives you a new URL and needs a new build — which is the
main reason this is a testing setup and not a home for the thing.

## Troubleshooting

| Symptom | Cause |
|---|---|
| App says a connection error | the tunnel terminal was closed, or the URL in the build was missing `/v1` |
| Login fails with an unknown tenant | the APK was built without `tenant_slug=acme` |
| `curl /health` says `"db":"down"` | the migrate job is still running — `docker compose -f backend/docker-compose.yml logs migrate` |
| The API container keeps restarting | `backend/.env` is missing, so it booted in production mode with development secrets |
