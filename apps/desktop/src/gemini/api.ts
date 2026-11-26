import { coreClient } from '../lib/storage'

/**
 * Google Gemini for world building. BrainWaves' own side keeps the API key and calls Gemini
 * (`crates/bw-api/src/gemini.rs`); the app only sends what to ask.
 */

export interface GeminiStatus {
  configured: boolean
  /** The key's last four characters. */
  hint: string | null
  model: string
}
export interface Message {
  role: 'user' | 'model'
  text: string
}

export const MODELS: { id: string; label: string }[] = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fast, free tier)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (best writing, slower)' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (fastest)' },
]

export const geminiStatus = () => coreClient().call<GeminiStatus>('geminiStatus')
export const setGeminiKey = (patch: { key?: string; model?: string }) => coreClient().call<GeminiStatus>('geminiSetKey', patch)

export async function ask(system: string, messages: Message[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  try {
    return await coreClient().call<string>('geminiGenerate', { system, messages, json: !!opts.json, temperature: opts.temperature })
  } catch (e) {
    throw new Error(String(e).replace(/^Error:\s*/, ''))
  }
}

/** Ask for JSON and read it (Gemini sometimes wraps it in a code fence). */
export async function askJSON<T>(system: string, prompt: string, temperature?: number): Promise<T> {
  const text = await ask(system, [{ role: 'user', text: prompt }], { json: true, temperature })
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(clean) as T
  } catch {
    const at = clean.search(/[[{]/)
    if (at >= 0) {
      try {
        return JSON.parse(clean.slice(at)) as T
      } catch {
        /* below */
      }
    }
    throw new Error('Gemini’s answer wasn’t in the expected shape. Try again.')
  }
}
