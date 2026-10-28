{{/* ── Names and labels ─────────────────────────────────────────────────── */}}

{{- define "usertasks.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "usertasks.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "usertasks.selectorLabels" -}}
app.kubernetes.io/name: {{ include "usertasks.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "usertasks.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "usertasks.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Pod labels for one component: selector labels + component (+ AKS workload identity). */}}
{{- define "usertasks.componentLabels" -}}
{{ include "usertasks.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "usertasks.podLabels" -}}
{{ include "usertasks.componentLabels" . }}
{{- if .root.Values.serviceAccount.workloadIdentity.azureClientId }}
azure.workload.identity/use: "true"
{{- end }}
{{- end -}}

{{- define "usertasks.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "usertasks.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* ── Images ───────────────────────────────────────────────────────────── */}}

{{- define "usertasks.imageRef" -}}
{{- $registry := .root.Values.global.imageRegistry | default "" | trimSuffix "/" -}}
{{- if $registry -}}{{ printf "%s/%s" $registry .image }}{{- else -}}{{ .image }}{{- end -}}
{{- end -}}

{{- define "usertasks.image" -}}
{{- $repo := include "usertasks.imageRef" (dict "root" . "image" .Values.image.repository) -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" $repo .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" $repo (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}
{{- end -}}

{{/* ── Secrets ──────────────────────────────────────────────────────────── */}}

{{/* The Secret every container reads (envFrom). */}}
{{- define "usertasks.secretName" -}}
{{- default (printf "%s-env" (include "usertasks.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{/* Credentials of the bundled dependencies. */}}
{{- define "usertasks.evalSecretName" -}}
{{- printf "%s-eval" (include "usertasks.fullname" .) -}}
{{- end -}}

{{- define "usertasks.bundled" -}}
{{- if or .Values.postgresql.enabled .Values.minio.enabled .Values.valkey.enabled .Values.mailpit.enabled -}}true{{- end -}}
{{- end -}}

{{/*
A value kept across upgrades: the existing Secret's key when there is one,
else a fresh random 32-byte hex string. Args: root, secret (name), key.
*/}}
{{- define "usertasks.persistentRandom" -}}
{{- $existing := lookup "v1" "Secret" .root.Release.Namespace .secret -}}
{{- if and $existing $existing.data (hasKey $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- randAlphaNum 64 | sha256sum -}}
{{- end -}}
{{- end -}}

{{/* ── Migrations ───────────────────────────────────────────────────────── */}}

{{/* "hook" or "job" (migrate.mode auto: hook only when the Secret exists before the release and the database isn't bundled). */}}
{{- define "usertasks.migrateMode" -}}
{{- $mode := .Values.migrate.mode -}}
{{- if eq $mode "auto" -}}
{{- if and .Values.secrets.existingSecret (not (include "usertasks.bundled" .)) -}}hook{{- else -}}job{{- end -}}
{{- else if and (eq $mode "hook") (include "usertasks.bundled" .) -}}
{{- fail "migrate.mode hook can't be used with bundled dependencies (they don't exist yet when a pre-install hook runs): use auto or job" -}}
{{- else -}}{{ $mode }}{{- end -}}
{{- end -}}

{{/* ── Configuration (the ConfigMap's keys) ─────────────────────────────── */}}

{{- define "usertasks.providerOptions" -}}
{{- .Files.Get "files/provider-options.json" -}}
{{- end -}}

{{/*
Every plain environment variable, as YAML (name: "value"). Order of
precedence (last wins): chart defaults, bundled dependencies, providers and
their options, the other sections, `env`.
*/}}
{{- define "usertasks.configEnv" -}}
{{- $root := . -}}
{{- $v := .Values -}}
{{- $table := (include "usertasks.providerOptions" . | fromJson).areas -}}
{{- $out := dict -}}
{{- $_ := set $out "DEPLOYMENT_MODE" "self_hosted" -}}
{{- $_ := set $out "NEXT_TELEMETRY_DISABLED" "1" -}}
{{- $appUrl := required "appUrl is required (the public origin, e.g. https://tasks.example.com)" $v.appUrl | trimSuffix "/" -}}
{{- $_ := set $out "APP_URL" $appUrl -}}
{{- $_ := set $out "NEXT_PUBLIC_APP_URL" $appUrl -}}
{{- if $v.instanceAdminEmails -}}
{{- $_ := set $out "INSTANCE_ADMIN_EMAILS" (join "," $v.instanceAdminEmails) -}}
{{- end -}}
{{- with $v.infrastructureUi -}}
{{- if eq (toString .switching) "false" -}}
{{- $_ := set $out "INFRA_UI_SWITCHING" "false" -}}
{{- end -}}
{{- if .backupDir -}}
{{- $_ := set $out "BACKUP_DIR" .backupDir -}}
{{- end -}}
{{- end -}}
{{- $fullname := include "usertasks.fullname" . -}}
{{- /* Bundled dependencies fill the options that are left empty. */ -}}
{{- if $v.minio.enabled -}}
{{- $_ := set $out "S3_ENDPOINT" (printf "http://%s-minio:9000" $fullname) -}}
{{- $_ := set $out "S3_REGION" "us-east-1" -}}
{{- $_ := set $out "S3_FORCE_PATH_STYLE" "true" -}}
{{- end -}}
{{- if $v.mailpit.enabled -}}
{{- $_ := set $out "SMTP_HOST" (printf "%s-mailpit" $fullname) -}}
{{- $_ := set $out "SMTP_PORT" "1025" -}}
{{- $_ := set $out "SMTP_STARTTLS" "off" -}}
{{- $_ := set $out "EMAIL_FROM" "UserTasks <noreply@usertasks.local>" -}}
{{- end -}}
{{- if $v.valkey.enabled -}}
{{- $_ := set $out "CACHE_REDIS_URL" (printf "redis://%s-valkey:6379" $fullname) -}}
{{- end -}}
{{- /* Providers. */ -}}
{{- range $area, $spec := $table -}}
{{- $cfg := index $v.providers $area | default dict -}}
{{- if $cfg.provider -}}
{{- if not (has $cfg.provider $spec.ids) -}}
{{- fail (printf "providers.%s.provider: unknown provider %q (one of %s)" $area $cfg.provider (join ", " $spec.ids)) -}}
{{- end -}}
{{- $_ := set $out $spec.env $cfg.provider -}}
{{- end -}}
{{- range $option, $value := ($cfg.options | default dict) -}}
{{- $envName := index $spec.options $option -}}
{{- if not $envName -}}
{{- fail (printf "providers.%s.options.%s: unknown option (see files/provider-options.json)" $area $option) -}}
{{- end -}}
{{- $text := "" -}}
{{- if or (kindIs "map" $value) (kindIs "slice" $value) -}}
{{- $text = toJson $value -}}
{{- else -}}
{{- $text = toString $value -}}
{{- end -}}
{{- if has $option $spec.secretOptions -}}
{{- if eq $option "sso_providers" -}}
{{- range $idp := $value -}}
{{- if and (kindIs "map" $idp) (hasKey $idp "clientSecret") (not (hasPrefix "secret://" (toString $idp.clientSecret))) -}}
{{- fail (printf "providers.auth.options.sso_providers: %s.clientSecret must be a secret://<name> reference (put the secret itself in the Secret)" (toString $idp.id)) -}}
{{- end -}}
{{- end -}}
{{- else if not (hasPrefix "secret://" $text) -}}
{{- fail (printf "providers.%s.options.%s is a secret: put %s in the Secret (secrets.*), or use a secret://<name> reference" $area $option $envName) -}}
{{- end -}}
{{- end -}}
{{- $_ := set $out $envName $text -}}
{{- end -}}
{{- end -}}
{{- /* Scheduler: web pods leave the ticking to the worker Deployment. */ -}}
{{- if and (eq (toString $v.providers.scheduler.provider) "worker") $v.worker.enabled -}}
{{- $_ := set $out "SCHEDULER_IN_PROCESS" "false" -}}
{{- end -}}
{{- /* Log export, security, CA, CSI. */ -}}
{{- if $v.logExport.allowInstanceIdentity -}}
{{- $_ := set $out "LOG_EXPORT_ALLOW_INSTANCE_IDENTITY" "true" -}}
{{- end -}}
{{- $logKeys := list "datadog_url" "event_hubs_url" "gcp_logging_url" "gcp_pubsub_url" "azure_authority_url" "gcp_token_url" -}}
{{- range $key, $value := $v.logExport.endpoints -}}
{{- if not (has $key $logKeys) -}}
{{- fail (printf "logExport.endpoints.%s: unknown (one of %s)" $key (join ", " $logKeys)) -}}
{{- end -}}
{{- $_ := set $out (printf "LOG_EXPORT_%s" (upper $key)) (toString $value) -}}
{{- end -}}
{{- $_ := set $out "ALLOW_PRIVATE_EGRESS" (toString $v.security.allowPrivateEgress) -}}
{{- $_ := set $out "ENABLE_CUSTOM_ACTIVITY_CODE" (toString $v.security.enableCustomActivityCode) -}}
{{- $_ := set $out "ALLOW_QUERY_KEY_AUTH" (toString $v.security.allowQueryKeyAuth) -}}
{{- if $v.security.mcpAllowedOrigins -}}
{{- $_ := set $out "MCP_ALLOWED_ORIGINS" (join "," $v.security.mcpAllowedOrigins) -}}
{{- end -}}
{{- if or $v.caBundle.configMap $v.caBundle.secret -}}
{{- $_ := set $out "NODE_EXTRA_CA_CERTS" (printf "/etc/usertasks/ca/%s" $v.caBundle.key) -}}
{{- end -}}
{{- if and $v.secrets.csi.enabled (not (hasKey $out "SECRETS_FILES_DIR")) -}}
{{- $_ := set $out "SECRETS_FILES_DIR" $v.secrets.csi.mountPath -}}
{{- end -}}
{{- range $key, $value := $v.env -}}
{{- $_ := set $out $key (toString $value) -}}
{{- end -}}
{{- toYaml $out -}}
{{- end -}}

{{/* ── Pod pieces shared by the app, worker and jobs ────────────────────── */}}

{{/* Args: root, config (ConfigMap name suffix, default "config"). */}}
{{- define "usertasks.envFrom" -}}
{{- $root := .root -}}
- configMapRef:
    name: {{ include "usertasks.fullname" $root }}-{{ .config | default "config" }}
{{- with $root }}
{{- if include "usertasks.bundled" . }}
- secretRef:
    name: {{ include "usertasks.evalSecretName" . }}
{{- end }}
- secretRef:
    name: {{ include "usertasks.secretName" . }}
{{- with .Values.extraEnvFrom }}
{{ toYaml . }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "usertasks.volumeMounts" -}}
- name: tmp
  mountPath: /tmp
- name: next-cache
  mountPath: /app/.next/cache
{{- if or .Values.caBundle.configMap .Values.caBundle.secret }}
- name: ca-bundle
  mountPath: /etc/usertasks/ca
  readOnly: true
{{- end }}
{{- if .Values.secrets.csi.enabled }}
- name: secrets-store
  mountPath: {{ .Values.secrets.csi.mountPath }}
  readOnly: true
{{- end }}
{{- with .Values.extraVolumeMounts }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "usertasks.volumes" -}}
- name: tmp
  emptyDir: {}
- name: next-cache
  emptyDir: {}
{{- if .Values.caBundle.configMap }}
- name: ca-bundle
  configMap:
    name: {{ .Values.caBundle.configMap }}
{{- else if .Values.caBundle.secret }}
- name: ca-bundle
  secret:
    secretName: {{ .Values.caBundle.secret }}
{{- end }}
{{- if .Values.secrets.csi.enabled }}
- name: secrets-store
  csi:
    driver: secrets-store.csi.k8s.io
    readOnly: true
    volumeAttributes:
      secretProviderClass: {{ default (include "usertasks.fullname" .) .Values.secrets.csi.secretProviderClass }}
{{- end }}
{{- with .Values.extraVolumes }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* Pod-level settings: service account, security context, pull secrets. Args: root, serviceAccount (optional name). */}}
{{- define "usertasks.podCommon" -}}
{{- $root := .root -}}
{{- with $root }}
{{- $wi := .Values.serviceAccount.workloadIdentity }}
serviceAccountName: {{ $.serviceAccount | default (include "usertasks.serviceAccountName" .) }}
automountServiceAccountToken: {{ or .Values.serviceAccount.automountServiceAccountToken (eq (toString (.Values.providers.secrets.options | default dict).vault_auth) "kubernetes") (eq (toString (.Values.providers.kms.options | default dict).vault_auth) "kubernetes") (ne (toString $wi.azureClientId) "") (ne (toString $wi.awsRoleArn) "") (ne (toString $wi.gcpServiceAccount) "") }}
securityContext:
  {{- toYaml .Values.podSecurityContext | nindent 2 }}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
The migrate hook's service account: a pre-install hook runs before the
release's ServiceAccount exists, so it gets its own (same annotations).
*/}}
{{- define "usertasks.migrateServiceAccountName" -}}
{{- if and (eq (include "usertasks.migrateMode" .) "hook") .Values.serviceAccount.create -}}
{{- printf "%s-migrate" (include "usertasks.fullname" .) -}}
{{- else -}}
{{- include "usertasks.serviceAccountName" . -}}
{{- end -}}
{{- end -}}

{{/*
A UserTasks container's image, security context, env and mounts (no name /
command). Args: root, config (see usertasks.envFrom), env (extra EnvVars).
*/}}
{{- define "usertasks.containerCommon" -}}
{{- $root := .root -}}
image: {{ include "usertasks.image" $root }}
imagePullPolicy: {{ $root.Values.image.pullPolicy }}
securityContext:
  {{- toYaml $root.Values.securityContext | nindent 2 }}
envFrom:
  {{- include "usertasks.envFrom" (dict "root" $root "config" .config) | nindent 2 }}
{{- $env := concat (.env | default list) ($root.Values.extraEnv | default list) }}
{{- with $env }}
env:
  {{- toYaml . | nindent 2 }}
{{- end }}
volumeMounts:
  {{- include "usertasks.volumeMounts" $root | nindent 2 }}
{{- end -}}

{{/* Waits until no migration is pending (job mode: until the migrate Job has run). */}}
{{- define "usertasks.waitForMigrations" -}}
{{- if and .Values.migrate.enabled .Values.waitForMigrations }}
- name: wait-for-migrations
  {{- include "usertasks.containerCommon" (dict "root" .) | nindent 2 }}
  command:
    - sh
    - -c
    - |
      until node admin.cjs db status 2>/dev/null | tail -n 1 | grep -q 'Up to date.'; do
        echo "waiting for database migrations (usertasks-admin db status)"; sleep 5
      done
  resources:
    requests: { cpu: 10m, memory: 128Mi }
    limits: { memory: 512Mi }
{{- end }}
{{- end -}}

{{/* Checksum of the configuration, so a change rolls the pods. */}}
{{- define "usertasks.configChecksum" -}}
{{- include "usertasks.configEnv" . | sha256sum -}}
{{- end -}}
