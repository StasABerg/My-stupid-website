{{/*
Expand the name of the chart.
*/}}
{{- define "my-stupid-website.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "my-stupid-website.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "my-stupid-website.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "my-stupid-website.labels" -}}
helm.sh/chart: {{ include "my-stupid-website.chart" . }}
{{ include "my-stupid-website.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "my-stupid-website.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-stupid-website.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Terminal service specific helpers
*/}}
{{- define "my-stupid-website.terminalName" -}}
{{- printf "%s-terminal" (include "my-stupid-website.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "my-stupid-website.terminalFullname" -}}
{{- printf "%s-terminal" (include "my-stupid-website.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "my-stupid-website.terminalSelectorLabels" -}}
app.kubernetes.io/name: {{ include "my-stupid-website.terminalName" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: terminal
{{- end }}

{{- define "my-stupid-website.terminalLabels" -}}
helm.sh/chart: {{ include "my-stupid-website.chart" . }}
{{ include "my-stupid-website.terminalSelectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "my-stupid-website.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "my-stupid-website.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
