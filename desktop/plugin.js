import * as sdk from '@hermes/plugin-sdk'
import { createElement as h, useEffect, useRef, useState } from 'react'

const route = '/dive-in'
const { host, ROUTES_AREA, SIDEBAR_NAV_AREA, SandboxedFrame, useValue } = sdk

function errorMessage(error) {
  return String(error?.message || error || 'Hermes request failed.').slice(0, 500)
}

function DiveIn({ ctx }) {
  const profile = useValue(host.state.profile)
  const gateway = useValue(host.state.gateway)
  const connection = useValue(host.state.connectionId ?? host.state.profile)
  const frame = useRef(null)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const connectionState = host.state.connectionId ?? host.state.profile
    const runs = new Map()
    const current = () => active && host.state.profile.get() === profile
      && connectionState.get() === connection
    setSrc('')
    setError('')
    setSession(null)
    if (!SandboxedFrame || gateway !== 'open') return () => { active = false }
    ctx.rest('/studio').then(result => {
      if (typeof result?.html !== 'string') throw Error('Hermes returned an invalid Studio page.')
      if (current()) setSrc('data:text/html;charset=utf-8,' + encodeURIComponent(result.html))
    }).catch(reason => {
      if (current()) setError(errorMessage(reason))
    })

    function finishRun(event) {
      const runId = runs.get(event.session_id)
      if (!runId || !current()) return
      runs.delete(event.session_id)
      if (event.type !== 'error' && !['error', 'interrupted', 'cancelled'].includes(event.payload?.status)) return
      ctx.rest('/action', { method: 'POST', body: {
        action: 'set_progress', run_id: runId, stage: 'blocked',
        message: 'Hermes could not finish this research. Open the research chat to see what happened and retry there.',
      } }).catch(() => {})
    }
    const stopError = ctx.onEvent('error', finishRun)
    const stopComplete = ctx.onEvent('message.complete', finishRun)

    async function receive(event) {
      const sender = frame.current?.contentWindow
      const message = event.data
      if (!sender || event.source !== sender || event.origin !== 'null'
          || message?.channel !== 'dive-in' || !Number.isSafeInteger(message.id) || !current()) return
      const { id, method, params } = message
      const respond = reply => {
        if (current() && frame.current?.contentWindow === sender) {
          sender.postMessage({ channel: 'dive-in-result', id, ...reply }, '*')
        }
      }
      try {
        if (method === 'action' && typeof params?.action === 'string') {
          respond({ result: await ctx.rest('/action', { method: 'POST', body: params }) })
        } else if (method === 'research' && typeof params?.prompt === 'string'
            && params.prompt.length > 0 && params.prompt.length <= 24000) {
          const socket = host.getGateway?.()
          const created = await host.request('session.create', { title: 'Dive In research', follow_profile_config: true }, 12000)
          if (!current() || host.getGateway?.() !== socket) return
          const sessionId = created?.session_id
          if (!sessionId) throw Error('Hermes did not create a research chat.')
          setSession(created.stored_session_id || null)
          if (/^[0-9a-f]{32}$/.test(params.runId || '')) runs.set(sessionId, params.runId)
          const toolInstructions = [
            'Use the Hermes tool signal_atlas_studio_action for Dive In evidence operations.',
            'Pass each operation as its action field with the corresponding parameters.',
            'If Hermes deferred the tool, get its schema with tool_describe and invoke it with tool_call.',
            'If Hermes cannot find the tool, ask the reader to enable the Dive In Agent switch and the Signal Atlas toolset.',
          ].join(' ') + '\n\n'
          try {
            const result = await host.request('prompt.submit', {
              session_id: sessionId, text: toolInstructions + params.prompt,
            }, 12000)
            respond({ result })
          } catch (error) {
            runs.delete(sessionId)
            throw error
          }
        } else if (method === 'open-link' && typeof params?.url === 'string') {
          const url = new URL(params.url)
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
            throw Error('Only public HTTP or HTTPS links can be opened.')
          }
          const opened = await ctx.os.openExternal(url.href)
          if (!opened) throw Error('The source link could not be opened.')
          respond({ result: true })
        } else {
          respond({ error: 'Unknown Dive In request.' })
        }
      } catch (reason) {
        const error = errorMessage(reason)
        respond({ error: method === 'research' && /provider|api key|not configured|needs setup/i.test(error)
          ? 'Configure a model provider in Hermes Settings, then retry. Your saved evidence stays in Dive In.'
          : error })
      }
    }
    window.addEventListener('message', receive)
    return () => {
      active = false
      stopError()
      stopComplete()
      window.removeEventListener('message', receive)
    }
  }, [ctx, connection, gateway, profile, reload])

  if (!SandboxedFrame || !src) {
    const message = !SandboxedFrame ? 'This Hermes Desktop build needs the SandboxedFrame SDK.'
      : error && /404|not found|disabled/i.test(error) ? 'Enable the Agent switch for Dive In in Capabilities → Plugins, then restart the gateway.'
        : error ? 'Dive In could not load from the Hermes gateway. Check the active profile and retry.'
        : gateway === 'closed' || gateway === 'error' ? 'The Hermes gateway is disconnected. Reconnect it to open Dive In.'
        : 'Connecting Dive In to the active Hermes profile…'
    return h('section', { style: { padding: 24 } },
      h('h2', null, 'Dive In'), h('p', { role: 'status' }, message),
      error && h('p', null, error),
      error && h('button', { type: 'button', onClick: () => setReload(n => n + 1) }, 'Retry'))
  }
  return h('section', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 },
  },
  session && h('button', {
    type: 'button',
    style: { alignSelf: 'flex-end', margin: '5px 12px' },
    onClick: () => host.openSession(session, { profile }).catch(error => host.notifyError(errorMessage(error))),
  }, 'Open research chat'),
  h(SandboxedFrame, {
    ref: frame, src, title: 'Dive In visual research workspace',
    // Let the Studio intercept its form submits. The page CSP prevents form navigation.
    sandbox: 'allow-scripts allow-forms',
    style: { width: '100%', flex: 1, minHeight: 0, border: 0 },
  }))
}

export default {
  id: 'signal-atlas',
  name: 'Dive In',
  description: 'A visual investigation workspace for claims, charts and linked evidence.',
  defaultEnabled: false,
  register(ctx) {
    ctx.registerMany([
      { id: 'dive-in-page', area: ROUTES_AREA, data: { path: route }, render: () => h(DiveIn, { ctx }) },
      { id: 'dive-in-nav', area: SIDEBAR_NAV_AREA, data: { path: route, label: 'Dive In', codicon: 'telescope' } },
    ])
  },
}
