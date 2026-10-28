export interface ConnectorLogoSource {
  src: string
  sourceUrl: string
  sourceLabel: string
}

export const CONNECTOR_LOGO_SOURCES: Record<string, ConnectorLogoSource> = {
  mercury: {
    src: "https://mercury.com/favicon.ico",
    sourceUrl: "https://mercury.com/",
    sourceLabel: "Mercury official site icon",
  },
  aws_s3: {
    src: "https://a0.awsstatic.com/libra-css/images/site/fav/favicon.ico",
    sourceUrl: "https://aws.amazon.com/",
    sourceLabel: "AWS official site icon",
  },
  azure_blob: {
    src: "https://azure.microsoft.com/favicon.ico",
    sourceUrl: "https://azure.microsoft.com/",
    sourceLabel: "Microsoft Azure official site icon",
  },
  azure_openai: {
    src: "https://azure.microsoft.com/favicon.ico",
    sourceUrl: "https://azure.microsoft.com/products/ai-services/openai-service",
    sourceLabel: "Microsoft Azure official site icon",
  },
  box: {
    src: "https://www.box.com/favicon.ico",
    sourceUrl: "https://www.box.com/",
    sourceLabel: "Box official site icon",
  },
  claude: {
    src: "https://www.anthropic.com/favicon.ico",
    sourceUrl: "https://www.anthropic.com/",
    sourceLabel: "Anthropic official site icon",
  },
  deepseek: {
    src: "https://www.deepseek.com/favicon.ico",
    sourceUrl: "https://www.deepseek.com/",
    sourceLabel: "DeepSeek official site icon",
  },
  docusign: {
    src: "https://www.docusign.com/favicon.ico",
    sourceUrl: "https://www.docusign.com/",
    sourceLabel: "Docusign official site icon",
  },
  dropbox: {
    src: "https://www.google.com/s2/favicons?domain=dropbox.com&sz=64",
    sourceUrl: "https://www.dropbox.com/",
    sourceLabel: "Dropbox official product icon",
  },
  exchange_online: {
    src: "https://www.google.com/s2/favicons?domain=outlook.com&sz=64",
    sourceUrl: "https://www.microsoft.com/microsoft-365/exchange/email",
    sourceLabel: "Microsoft Exchange / Outlook official product icon",
  },
  firebase: {
    src: "https://firebase.google.com/favicon.ico",
    sourceUrl: "https://firebase.google.com/",
    sourceLabel: "Firebase official site icon",
  },
  gmail: {
    src: "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico",
    sourceUrl: "https://www.google.com/gmail/about/",
    sourceLabel: "Google Gmail official product icon",
  },
  google_docs: {
    src: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico",
    sourceUrl: "https://docs.google.com/",
    sourceLabel: "Google Docs official product icon",
  },
  google_drive: {
    src: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png",
    sourceUrl: "https://www.google.com/drive/",
    sourceLabel: "Google Drive official product icon",
  },
  google_gemini: {
    src: "https://www.gstatic.com/lamda/images/gemini_favicon_f069958c85030456e93de685481c559f160ea06b.png",
    sourceUrl: "https://gemini.google.com/",
    sourceLabel: "Google Gemini official product icon",
  },
  google_tasks: {
    src: "https://www.google.com/s2/favicons?domain=tasks.google.com&sz=64",
    sourceUrl: "https://tasks.google.com/",
    sourceLabel: "Google Tasks official product icon",
  },
  groq: {
    src: "https://groq.com/favicon.ico",
    sourceUrl: "https://groq.com/",
    sourceLabel: "Groq official site icon",
  },
  jira: {
    src: "https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png",
    sourceUrl: "https://www.atlassian.com/software/jira",
    sourceLabel: "Atlassian official site icon",
  },
  mistral: {
    src: "https://mistral.ai/favicon.ico",
    sourceUrl: "https://mistral.ai/",
    sourceLabel: "Mistral AI official site icon",
  },
  mongodb: {
    src: "https://www.mongodb.com/favicon.ico",
    sourceUrl: "https://www.mongodb.com/",
    sourceLabel: "MongoDB official site icon",
  },
  ms_dataverse: {
    src: "https://www.google.com/s2/favicons?domain=powerplatform.microsoft.com&sz=64",
    sourceUrl: "https://powerplatform.microsoft.com/dataverse/",
    sourceLabel: "Microsoft Power Platform / Dataverse official product icon",
  },
  ms_teams: {
    src: "https://www.google.com/s2/favicons?domain=teams.microsoft.com&sz=64",
    sourceUrl: "https://www.microsoft.com/microsoft-teams/group-chat-software",
    sourceLabel: "Microsoft Teams official product icon",
  },
  mssql: {
    src: "https://www.microsoft.com/favicon.ico",
    sourceUrl: "https://www.microsoft.com/sql-server/",
    sourceLabel: "Microsoft SQL Server official site icon",
  },
  mysql: {
    src: "https://www.google.com/s2/favicons?domain=mysql.com&sz=64",
    sourceUrl: "https://www.mysql.com/",
    sourceLabel: "MySQL official site icon",
  },
  n8n: {
    src: "https://n8n.io/favicon.ico",
    sourceUrl: "https://n8n.io/",
    sourceLabel: "n8n official site icon",
  },
  ollama: {
    src: "https://www.google.com/s2/favicons?domain=ollama.com&sz=64",
    sourceUrl: "https://ollama.com/",
    sourceLabel: "Ollama official site icon",
  },
  onedrive_business: {
    src: "https://www.google.com/s2/favicons?domain=onedrive.live.com&sz=64",
    sourceUrl: "https://www.microsoft.com/microsoft-365/onedrive/online-cloud-storage",
    sourceLabel: "Microsoft OneDrive official product icon",
  },
  openai: {
    src: "https://www.google.com/s2/favicons?domain=openai.com&sz=64",
    sourceUrl: "https://openai.com/",
    sourceLabel: "OpenAI official site icon",
  },
  oracle: {
    src: "https://www.oracle.com/favicon.ico",
    sourceUrl: "https://www.oracle.com/",
    sourceLabel: "Oracle official site icon",
  },
  perplexity: {
    src: "https://www.perplexity.ai/favicon.ico",
    sourceUrl: "https://www.perplexity.ai/",
    sourceLabel: "Perplexity official site icon",
  },
  postgres: {
    src: "https://www.postgresql.org/favicon.ico",
    sourceUrl: "https://www.postgresql.org/",
    sourceLabel: "PostgreSQL official site icon",
  },
  salesforce: {
    src: "https://www.salesforce.com/favicon.ico",
    sourceUrl: "https://www.salesforce.com/",
    sourceLabel: "Salesforce official site icon",
  },
  sap_odata: {
    src: "https://www.google.com/s2/favicons?domain=sap.com&sz=64",
    sourceUrl: "https://www.sap.com/",
    sourceLabel: "SAP official site icon",
  },
  sendgrid: {
    src: "https://sendgrid.com/favicon.ico",
    sourceUrl: "https://sendgrid.com/",
    sourceLabel: "SendGrid official site icon",
  },
  servicenow: {
    src: "https://www.servicenow.com/favicon.ico",
    sourceUrl: "https://www.servicenow.com/",
    sourceLabel: "ServiceNow official site icon",
  },
  sharepoint: {
    src: "https://www.google.com/s2/favicons?domain=sharepoint.com&sz=64",
    sourceUrl: "https://www.microsoft.com/microsoft-365/sharepoint/collaboration",
    sourceLabel: "Microsoft SharePoint official product icon",
  },
  slack: {
    src: "https://slack.com/favicon.ico",
    sourceUrl: "https://slack.com/",
    sourceLabel: "Slack official site icon",
  },
  snowflake: {
    src: "https://www.snowflake.com/favicon.ico",
    sourceUrl: "https://www.snowflake.com/",
    sourceLabel: "Snowflake official site icon",
  },
  stripe: {
    src: "https://stripe.com/favicon.ico",
    sourceUrl: "https://stripe.com/",
    sourceLabel: "Stripe official site icon",
  },
  together: {
    src: "https://www.google.com/s2/favicons?domain=together.ai&sz=64",
    sourceUrl: "https://www.together.ai/",
    sourceLabel: "Together AI official site icon",
  },
  twilio: {
    src: "https://www.twilio.com/favicon.ico",
    sourceUrl: "https://www.twilio.com/",
    sourceLabel: "Twilio official site icon",
  },
  ukg_pro: {
    src: "https://www.google.com/s2/favicons?domain=ukg.com&sz=64",
    sourceUrl: "https://www.ukg.com/",
    sourceLabel: "UKG official site icon",
  },
  workday: {
    src: "https://www.google.com/s2/favicons?domain=workday.com&sz=64",
    sourceUrl: "https://www.workday.com/",
    sourceLabel: "Workday official site icon",
  },
}

export function getConnectorLogoSource(key: string) {
  return CONNECTOR_LOGO_SOURCES[key] ?? null
}
