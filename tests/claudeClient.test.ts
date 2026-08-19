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

import { extractStructuredDataFromPdf, extractStructuredDataFromText, ExtractionParseError } from '../lib/claudeClient'

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

describe('extractStructuredDataFromPdf with markdown-fenced JSON', () => {
  it('strips ```json fences before parsing (observed real-world Claude behavior despite prompt instructions)', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    ;(anthropicModule.default as any).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '```json\n{"foo": "bar"}\n```' }],
          }),
        },
      }
    })
    const result = await extractStructuredDataFromPdf<{ foo: string }>({
      pdfBase64: 'x',
      systemPrompt: 'x',
      schemaDescription: 'x',
    })
    expect(result).toEqual({ foo: 'bar' })
  })

  it('strips plain ``` fences (no language tag) before parsing', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    ;(anthropicModule.default as any).mockImplementation(function () {
      return {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: '```\n{"foo": "baz"}\n```' }],
          }),
        },
      }
    })
    const result = await extractStructuredDataFromPdf<{ foo: string }>({
      pdfBase64: 'x',
      systemPrompt: 'x',
      schemaDescription: 'x',
    })
    expect(result).toEqual({ foo: 'baz' })
  })
})

describe('extractStructuredDataFromText', () => {
  it('sends the text as a plain user message and parses a valid JSON response', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    const createMock = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"foo": "bar"}' }] })
    ;(anthropicModule.default as any).mockImplementation(function () {
      return { messages: { create: createMock } }
    })

    const result = await extractStructuredDataFromText<{ foo: string }>({
      text: 'Room 101 | Rent | 100000',
      systemPrompt: 'Extract data',
      schemaDescription: '{ foo: string }',
    })

    expect(result).toEqual({ foo: 'bar' })
    const callArgs = createMock.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Room 101 | Rent | 100000')
  })

  it('throws ExtractionParseError when the model does not return valid JSON', async () => {
    const anthropicModule = await import('@anthropic-ai/sdk')
    ;(anthropicModule.default as any).mockImplementation(function () {
      return {
        messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] }) },
      }
    })
    await expect(
      extractStructuredDataFromText({ text: 'x', systemPrompt: 'x', schemaDescription: 'x' })
    ).rejects.toThrow(ExtractionParseError)
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
