using './main.bicep'

param name = 'usertasks'
// First deployment: false. Push the image, then deploy again with true.
param deployApps = true
param imageTag = 'latest'
// param appUrl = 'https://tasks.example.com'
param instanceAdminEmails = 'ops@example.com'
param authProvider = 'builtin'
param communicationDataLocation = 'Europe'

// Generated outside the template and passed from the environment:
//   export USERTASKS_ENCRYPTION_KEY=$(openssl rand -hex 32)
//   export USERTASKS_CRON_SECRET=$(openssl rand -hex 32)
// Keep the same values on later deployments (a new ENCRYPTION_KEY makes
// already-encrypted settings unreadable).
param encryptionKey = readEnvironmentVariable('USERTASKS_ENCRYPTION_KEY', '')
param cronSecret = readEnvironmentVariable('USERTASKS_CRON_SECRET', '')
