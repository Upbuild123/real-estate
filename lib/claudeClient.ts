import Anthropic from '@anthropic-ai/sdk'

export class ExtractionParseError extends Error {}

export async function extractStructuredDataFromPdf<T>(params: {
  pdfBase64: string
  systemPrompt: string
  schemaDescription: string
}): Promise<T> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: `${params.systemPrompt}\n\nRespond with ONLY valid JSON matching this shape, no prose, no markdown fences:\n${params.schemaDescription}`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: params.pdfBase64 },
          },
          { type: 'text', text: 'Extract the data as specified.' },
        ],
      },
    ],
  })

  const textBlock = response.content.find((block: any) => block.type === 'text')
  const text = (textBlock as any)?.text ?? ''

  try {
    return JSON.parse(stripMarkdownFences(text)) as T
  } catch {
    throw new ExtractionParseError(`Model did not return valid JSON: ${text.slice(0, 200)}`)
  }
}

// Despite the system prompt explicitly saying "no markdown fences," Claude sometimes wraps
// its JSON response in a ```json ... ``` (or plain ``` ... ```) code block anyway — observed
// in production. Strip fences defensively rather than relying solely on prompt adherence.
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/)
  return fenced ? fenced[1].trim() : trimmed
}
