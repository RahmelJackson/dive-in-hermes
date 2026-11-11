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
  const frame = useRef(null)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    const epoch = sdk.gatewayActivationEpoch?.()
    const current = () => active && host.state.profile.get() === profile
      && sdk.gatewayActivationEpoch?.() === epoch
    setSrc('')
    setError('')
    setSession(null)
    if (!SandboxedFrame || gateway !== 'open') return () => { active = false }
    ctx.rest('/studio').then(result => {
      if (current()) setSrc('data:text/html;charset=utf-8,' + encodeURIComponent(result.html))
    }).catch(reason => {
      if (current()) setError(errorMessage(reason))
    })

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
          const created = await host.request('session.create', { title: 'Dive In research' })
          if (!current()) return
          if (!created?.session_id) throw Error('Hermes did not create a research chat.')
          const response = await host.request('prompt.submit', {
            session_id: created.session_id, text: params.prompt,
          })
          if (!current()) return
          setSession(created.stored_session_id || null)
          respond({ result: response })
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
        respond({ error: errorMessage(reason) })
      }
    }
    window.addEventListener('message', receive)
    return () => {
      active = false
      window.removeEventListener('message', receive)
    }
  }, [ctx, gateway, profile, reload])

  if (!SandboxedFrame || !src) {
    const message = !SandboxedFrame ? 'This Hermes Desktop build needs the SandboxedFrame SDK.'
      : error ? 'Enable Signal Atlas in the active Hermes profile, then reload the gateway.'
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
    onClick: () => host.openSession(session, { profile }),
  }, 'Open research chat'),
  h(SandboxedFrame, {
    ref: frame, src, title: 'Dive In visual research workspace',
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
