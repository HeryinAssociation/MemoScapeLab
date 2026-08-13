# Self-hosted deployment

This deployment runs the built Worker in Wrangler's local Cloudflare-compatible
runtime. D1 and R2 data are persisted under `deploy/self-hosted/data`.
It requires a Docker host that can pull the Node 22 Debian image.
The image installs the system CA bundle, and Compose also mounts the Debian
host CA bundle read-only so Worker `fetch()` can verify external HTTPS APIs.
For Tencent SES, the self-hosted stack also runs an unexposed, fixed-upstream
proxy on the private Compose network. The Worker still signs the Tencent request;
the proxy only performs strict system-CA TLS verification and forwards it to the
hard-coded SES hostname.
The same unexposed proxy handles signed LightCOS requests, restricted to the two
configured bucket hostnames in the configured region. It supports uploads,
downloads, object checks, and deletes without weakening TLS verification.

Create `deploy/self-hosted/secrets.dev.vars` from `.dev.vars.example`, then run:

```sh
docker compose -f deploy/self-hosted/compose.yaml up -d --build
```

On a host that cannot pull the Node image, put the official
`node-v22.19.0-linux-x64.tar.gz` archive at the repository root and use the
offline build override:

```sh
docker compose -f deploy/self-hosted/compose.yaml -f deploy/self-hosted/compose.offline.yaml up -d --build
```

To create a source package on Windows, run this from the repository root:

```powershell
./deploy/self-hosted/package-source.ps1
```

The packaging script uses Git's tracked and non-ignored file list instead of
unanchored `tar --exclude` patterns. It also verifies that the `/work` and
`/imagegen` route sources are present and that local secret files are absent.

The application listens on host port `18787`. Keep the secrets file mode at
`0600` and back up the `data` directory regularly.
