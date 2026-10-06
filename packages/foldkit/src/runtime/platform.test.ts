/* eslint-disable @typescript-eslint/consistent-type-assertions */
import { Predicate, Schema } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Html, __htmlBuilder } from '../html/index.js'
import { defineMessageUnion } from '../message/index.js'
import { makeApplication } from './makeApplication.js'
import { makeElement } from './makeElement.js'
import {
  type DOMAPI,
  type Module,
  type Platform,
  type VNode,
  browserPlatform,
  onUnmountModule,
} from './public.js'
import { embed } from './start.js'

// NOTE: a plain-object node tree standing in for a non-DOM host. Nothing in
// it is a DOM Node, so any code path that bypasses the Platform and touches
// the node with DOM methods throws.
type FakeNode = {
  kind: 'Element' | 'Text' | 'Comment'
  tag: string
  text: string
  id: string
  parent: FakeNode | undefined
  children: Array<FakeNode>
  props: Record<string, unknown>
  listeners: Record<string, (event: unknown) => void>
}

const makeFakeNode = (
  kind: FakeNode['kind'],
  tag = '',
  text = '',
): FakeNode => ({
  kind,
  tag,
  text,
  id: '',
  parent: undefined,
  children: [],
  props: {},
  listeners: {},
})

const asNode = (node: FakeNode): Node => node as unknown as Node
const asFake = (node: Node): FakeNode => node as unknown as FakeNode

const detach = (child: FakeNode): void => {
  if (child.parent !== undefined) {
    const siblings = child.parent.children
    siblings.splice(siblings.indexOf(child), 1)
    child.parent = undefined
  }
}

const fakeDomApi: DOMAPI = {
  createElement: (tagName: string) =>
    makeFakeNode('Element', tagName) as unknown as HTMLElement,
  createElementNS: (_namespace: string, tagName: string) =>
    makeFakeNode('Element', tagName) as unknown as Element,
  createTextNode: (text: string) =>
    makeFakeNode('Text', '', text) as unknown as Text,
  createComment: (text: string) =>
    makeFakeNode('Comment', '', text) as unknown as Comment,
  insertBefore: (parentNode, newNode, referenceNode) => {
    const parent = asFake(parentNode)
    const child = asFake(newNode)
    detach(child)
    child.parent = parent
    if (referenceNode === null) {
      parent.children.push(child)
    } else {
      parent.children.splice(
        parent.children.indexOf(asFake(referenceNode)),
        0,
        child,
      )
    }
  },
  removeChild: (_node, child) => detach(asFake(child)),
  appendChild: (node, child) => {
    const parent = asFake(node)
    const fakeChild = asFake(child)
    detach(fakeChild)
    fakeChild.parent = parent
    parent.children.push(fakeChild)
  },
  parentNode: node => {
    const { parent } = asFake(node)
    return parent === undefined ? null : asNode(parent)
  },
  nextSibling: node => {
    const { parent } = asFake(node)
    if (parent === undefined) {
      return null
    }
    const next = parent.children[parent.children.indexOf(asFake(node)) + 1]
    return next === undefined ? null : asNode(next)
  },
  tagName: elm => asFake(elm).tag,
  setTextContent: (node, text) => {
    const fake = asFake(node)
    fake.children.forEach(child => {
      child.parent = undefined
    })
    fake.children = []
    fake.text = text ?? ''
  },
  getTextContent: node => asFake(node).text,
  isElement: (node): node is Element => asFake(node).kind === 'Element',
  isText: (node): node is Text => asFake(node).kind === 'Text',
  isComment: (node): node is Comment => asFake(node).kind === 'Comment',
}

type FakeListener = (this: VNode, event: unknown, vnode: VNode) => void

const elmOf = (vnode: VNode): FakeNode => vnode.elm as unknown as FakeNode

const writeFakeProps = (_oldVNode: VNode, vnode: VNode): void => {
  Object.assign(elmOf(vnode).props, vnode.data?.props)
}

const fakePropsModule: Partial<Module> = {
  create: writeFakeProps,
  update: writeFakeProps,
}

const writeFakeListeners = (_oldVNode: VNode, vnode: VNode): void => {
  const elm = elmOf(vnode)
  elm.listeners = {}
  Object.entries(vnode.data?.on ?? {}).forEach(([name, handler]) => {
    if (Predicate.isFunction(handler)) {
      const listener = handler as FakeListener
      elm.listeners[name] = event => listener.call(vnode, event, vnode)
    }
  })
}

const fakeEventsModule: Partial<Module> = {
  create: writeFakeListeners,
  update: writeFakeListeners,
}

const makeFakePlatform = () => {
  const frameCallbacks: Array<() => void> = []
  const platform: Platform = {
    domApi: fakeDomApi,
    modules: [fakeEventsModule, onUnmountModule, fakePropsModule],
    requestFrame: callback => {
      frameCallbacks.push(callback)
    },
  }
  const runFrames = (): void => {
    frameCallbacks.splice(0).forEach(callback => callback())
  }
  return { platform, runFrames, frameCallbacks }
}

const makeFakeHost = () => {
  const root = makeFakeNode('Element', 'root')
  const container = makeFakeNode('Element', 'container')
  container.id = 'app'
  fakeDomApi.appendChild(asNode(root), asNode(container))
  return { root, container }
}

const textOf = (node: FakeNode): string =>
  node.kind === 'Element' ? node.children.map(textOf).join('') : node.text

const findByTag = (node: FakeNode, tag: string): FakeNode | undefined => {
  if (node.tag === tag) {
    return node
  }
  for (const child of node.children) {
    const found = findByTag(child, tag)
    if (found !== undefined) {
      return found
    }
  }
  return undefined
}

const Message = defineMessageUnion({
  ClickedIncrement: {},
  ChangedName: { name: Schema.String },
})
type Message = typeof Message.Type

const Model = Schema.Struct({ count: Schema.Number, name: Schema.String })
type Model = typeof Model.Type

const h = __htmlBuilder<Message>()

const update = (model: Model, message: Message) =>
  Message.match<{ model: Model }>(message, {
    ClickedIncrement: () => ({ model: { ...model, count: model.count + 1 } }),
    ChangedName: ({ name }) => ({
      model: { ...model, name: name.toUpperCase() },
    }),
  })

const view = (model: Model): Html =>
  h.div(
    [],
    [
      h.button([h.OnClick(Message.ClickedIncrement())], ['increment']),
      h.span([], [`count:${model.count}`]),
      h.input([
        h.Value(model.name),
        h.OnInput(name => Message.ChangedName({ name })),
      ]),
    ],
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Platform', () => {
  it('renders, patches on its own frame, and restores the container on dispose without touching the DOM', async () => {
    const { platform, runFrames } = makeFakePlatform()
    const { root, container } = makeFakeHost()
    const bodyBefore = document.body.innerHTML

    const handle = embed(
      makeElement({
        Model,
        init: () => ({ model: { count: 0, name: '' } }),
        update,
        view,
        container: container as unknown as HTMLElement,
        platform,
      }),
    )

    try {
      await vi.waitFor(() => {
        expect(textOf(root)).toContain('count:0')
      })
      expect(root.children).not.toContain(container)

      findByTag(root, 'button')!.listeners['click']!({ type: 'click' })
      expect(textOf(root)).toContain('count:0')

      runFrames()
      expect(textOf(root)).toContain('count:1')
    } finally {
      handle.dispose()
    }

    await vi.waitFor(() => {
      expect(root.children).toEqual([container])
    })
    expect(container.children).toEqual([])
    expect(document.body.innerHTML).toBe(bodyBefore)
  })

  it('drives a controlled input on a host with no Element global', async () => {
    vi.stubGlobal('Element', undefined)
    const { platform, runFrames } = makeFakePlatform()
    const { root, container } = makeFakeHost()

    const handle = embed(
      makeElement({
        Model,
        init: () => ({ model: { count: 0, name: '' } }),
        update,
        view,
        container: container as unknown as HTMLElement,
        platform,
      }),
    )

    try {
      await vi.waitFor(() => {
        expect(findByTag(root, 'input')).toBeDefined()
      })

      findByTag(root, 'input')!.listeners['input']!({
        type: 'input',
        target: { value: 'hello' },
      })
      runFrames()

      expect(findByTag(root, 'input')!.props['value']).toBe('HELLO')
      expect(textOf(root)).not.toContain('Application Crash')
    } finally {
      handle.dispose()
    }
  })

  it('boots a makeApplication app without looking up hydration or writing document metadata', async () => {
    const { platform } = makeFakePlatform()
    const { root, container } = makeFakeHost()
    document.title = 'host page'

    const handle = embed(
      makeApplication({
        Model,
        init: () => ({ model: { count: 0, name: '' } }),
        update,
        view: model => ({ title: 'native app', body: view(model) }),
        container: container as unknown as HTMLElement,
        platform,
      }),
    )

    try {
      await vi.waitFor(() => {
        expect(textOf(root)).toContain('count:0')
      })
      expect(document.title).toBe('host page')
    } finally {
      handle.dispose()
    }
  })

  it('treats an explicit browserPlatform as the default: makeApplication still writes document metadata', async () => {
    const container = document.createElement('div')
    container.id = 'browser-app'
    document.body.appendChild(container)
    document.title = 'host page'

    const handle = embed(
      makeApplication({
        Model,
        init: () => ({ model: { count: 0, name: '' } }),
        update,
        view: model => ({ title: 'browser app', body: view(model) }),
        container,
        platform: browserPlatform,
      }),
    )

    try {
      await vi.waitFor(() => {
        expect(document.title).toBe('browser app')
      })
    } finally {
      handle.dispose()
      container.remove()
    }
  })
})
