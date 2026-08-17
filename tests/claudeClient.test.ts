import { describe, it, expect, vi } from 'vitest'

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '{"foo": "bar"}' }],
          }),
        },
      }
    }),
  }
})

import { extractStructuredDataFromPdf, ExtractionParseError } from '../lib/claudeClient'

describe('extractStructuredDataFromPdf', () => {
  it('parses a valid JSON response into the expected shape', async () => {
    const result = await extractStructuredDataFromPdf<{ foo: string }>({
      pdfBase64: 'ZmFrZS1wZGY=',
      systemPrompt: 'Extract data',
      schemaDescription: '{ foo: string }',
    })
    expect(result).toEqual({ foo: 'bar' })
  })
})

describe('extractStructuredDataFromPdf with malformed response', () => {
  it('throws ExtractionParseError when the model does not return valid JSON', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    ;(anthropicModule.default as any).mockImplementation(function () {
      return {
        messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] }) },
      }
    })
    await expect(
      extractStructuredDataFromPdf({ pdfBase64: 'x', systemPrompt: 'x', schemaDescription: 'x' })
    ).rejects.toThrow(ExtractionParseError)
  })
})
