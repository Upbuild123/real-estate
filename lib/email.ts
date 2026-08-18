const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatMonthLabel(month: string): string {
  const [year, mo] = month.split('-')
  return `${MONTH_NAMES[Number(mo) - 1]} ${year}`
}

// Sent via a direct call to Resend's HTTP API — same reasoning as the Dropbox content
// download: avoid depending on an SDK's own runtime-environment assumptions in a serverless
// function, when a plain fetch does the job in one call.
export async function sendStatementsReadyEmail(params: {
  to: string
  month: string
  propertyNames: string[]
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const monthLabel = formatMonthLabel(params.month)
  const propertyList = params.propertyNames.map((name) => `<li>${name}</li>`).join('')

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Property Financials <onboarding@resend.dev>',
      to: [params.to],
      subject: `${monthLabel} statements are ready`,
      html: `<p>Both property manager statements for <strong>${monthLabel}</strong> have been received and processed.</p>
<ul>${propertyList}</ul>
<p><a href="https://property-financials-app-michael-2972s-projects.vercel.app/dashboard">View the dashboard</a></p>`,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Resend API request failed (${response.status}): ${errorText}`)
  }
}
