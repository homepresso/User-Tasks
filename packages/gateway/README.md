# UserTasks on-premises gateway

Lets UserTasks (UserTasks Cloud, or an instance in another network) reach systems on your network — SharePoint Server, internal APIs — **without any inbound connection**. The gateway runs on a server inside your network, dials out to your UserTasks address over HTTPS, takes the connector requests queued for it and runs them against the targets you configure, with credentials that stay on the gateway.

- Outbound HTTPS only (optional corporate proxy and extra CA). Every request signed with the instance's own Ed25519 key, every answer signed by UserTasks.
- Only the targets in `gateway.json` are reachable (origin + optional path prefixes and methods). UserTasks names a target id and a path — never a URL.
- Windows (NTLMv2 / Negotiate / Kerberos, channel binding) authentication with credentials from a file or an environment variable.
- Several instances share the work (high availability). Optional **relay** for systems that call back (SharePoint remote event receivers).

## Install (Windows Server)

```powershell
# elevated PowerShell, in the extracted release folder
.\Install-UserTasksGateway.ps1 -CloudUrl https://acme.usertasks.com -Token utgwr_...
notepad "$env:ProgramData\UserTasks Gateway\gateway.json"   # targets, relay
Start-Service UserTasksGateway
```

Upgrade: `.\Install-UserTasksGateway.ps1 -Upgrade` (one instance at a time). Remove: `-Uninstall [-Purge]`. Logs: `C:\ProgramData\UserTasks Gateway\logs`.

## Docker

```bash
docker build -f packages/gateway/Dockerfile -t usertasks-gateway .   # from the repository root
docker run -d --name usertasks-gateway --restart unless-stopped --stop-timeout 90 \
  -v usertasks-gateway:/var/lib/usertasks-gateway -v $PWD/gateway.json:/etc/usertasks-gateway/gateway.json:ro \
  -e UTGW_REGISTRATION_TOKEN=utgwr_... usertasks-gateway register-and-run
```

## gateway.json

See the header of `src/config.ts` for every option. Minimal:

```json
{
  "cloudUrl": "https://acme.usertasks.com",
  "targets": [
    { "id": "sharepoint", "url": "https://sharepoint.contoso.com",
      "auth": { "type": "windows", "mode": "negotiate", "username": "CONTOSO\\svc-usertasks", "passwordFile": "C:\\ProgramData\\UserTasks Gateway\\sharepoint.pwd" } }
  ]
}
```

## Commands

`register --token …`, `run`, `register-and-run`, `check`, `status`, `rotate-key`, `version` (all accept `--config <file>`).

Build: `npx tsup` → `dist/usertasks-gateway.mjs` (Node 20+, no runtime dependencies; install the optional `kerberos` package next to it for Kerberos). Design and threat model: `docs/gateway.md` in the UserTasks repository.
