import { configuredAppUrl, processorSecret } from '@/lib/config/bootstrap'
/** Fire-and-forget nudge to the deployment worker (kick pattern). */
export function kickGitHubDeployWorker(): void {
  try {
    const baseUrl = configuredAppUrl()?.trim() || 'http://localhost:3000'
    const secret = processorSecret()
    void fetch(`${baseUrl}/api/github-sync/deployments/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Processor-Secret': secret } : {}),
      },
      body: JSON.stringify({}),
    }).catch(() => {})
  } catch { /* never throw from a kick */ }
}
