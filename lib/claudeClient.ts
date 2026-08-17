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
    max_tokens: 4096,
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
    return JSON.parse(text) as T
  } catch {
    throw new ExtractionParseError(`Model did not return valid JSON: ${text.slice(0, 200)}`)
  }
}
