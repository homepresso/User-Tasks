{{/* Shared pieces of the bundled (evaluation) dependencies. Args: root, name. */}}
{{- define "usertasks.eval.labels" -}}
{{ include "usertasks.selectorLabels" .root }}
app.kubernetes.io/component: {{ .name }}
usertasks.com/bundled: "true"
{{- end -}}

{{- define "usertasks.eval.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{- define "usertasks.eval.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
fsGroup: {{ .uid }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* A ClusterIP Service for a bundled dependency. Args: root, name, ports (list of dicts name/port). */}}
{{- define "usertasks.eval.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "usertasks.fullname" .root }}-{{ .name }}
  labels:
    {{- include "usertasks.labels" .root | nindent 4 }}
    app.kubernetes.io/component: {{ .name }}
spec:
  ports:
    {{- range .ports }}
    - name: {{ .name }}
      port: {{ .port }}
      targetPort: {{ .port }}
    {{- end }}
  selector:
    {{- include "usertasks.selectorLabels" .root | nindent 4 }}
    app.kubernetes.io/component: {{ .name }}
{{- end -}}
