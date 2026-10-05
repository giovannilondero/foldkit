import { Option } from 'effect'

import { type Platform, browserPlatform } from './platform.js'
import { type VNode, h, init, toVNode } from './snabbdom/index.js'

export type { VNode } from './snabbdom/index.js'
export { toVNode }

const makePatch = (platform: Platform) =>
  init([...platform.modules], platform.domApi)

/** The patch function bound to the browser Platform. */
export const patch = makePatch(browserPlatform)

// NOTE: snabbdom records each element's live DOM node on `vnode.elm` by
// mutating the vnode object during patch, and assumes one vnode object per tree
// position. A vnode object placed in more than one position would share a single
// `.elm`, so removals and text updates land on the wrong DOM node.
// `dedupeSharedVNodes` clones any vnode reached a second time within a render,
// or arriving with an `.elm` already set from a prior render, so every position
// gets its own object. Allocation happens only where reuse is actually found; a
// tree of freshly constructed vnodes returns unchanged.
//
// `createLazy`/`createKeyedLazy` results are recorded in `memoizedVNodes` and
// kept opaque here, so snabbdom's same-vnode short-circuit on a cache hit
// survives and the cached subtree is not walked. Their own contents are deduped
// separately by `dedupeMemoizedResult`, which the lazy helpers run on the freshly
// built subtree on a cache miss. Both passes share one per-render `seen` set
// (carried on the boundary registry and cleared each render), so a const reused
// INSIDE a memoized view, or across memoized siblings, is cloned just like a
// const reused anywhere else. A cache hit rebuilds nothing and is left
// untouched: a const inside the cached subtree still carries the `.elm` snabbdom
// set last render, so reuse of it elsewhere this render is cloned by the
// prior-render `.elm` rule above rather than the per-render set.
export const memoizedVNodes = new WeakSet<VNode>()

const dedupeChildList = (
  children: ReadonlyArray<VNode | string>,
  seen: Set<object>,
): Array<VNode | string> | undefined => {
  let nextChildren: Array<VNode | string> | undefined
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!
    const deduped = typeof child === 'string' ? child : visit(child, seen)
    if (deduped !== child) {
      if (nextChildren === undefined) {
        nextChildren = children.slice()
      }
      nextChildren[index] = deduped
    }
  }
  return nextChildren
}

const visit = (node: VNode, seen: Set<object>): VNode => {
  const isDuplicate = seen.has(node)
  if (!isDuplicate && memoizedVNodes.has(node)) {
    seen.add(node)
    return node
  }
  const base: VNode =
    isDuplicate || node.elm != null ? { ...node, elm: undefined } : node
  seen.add(node)
  if (base.children === undefined) {
    return base
  }
  const nextChildren = dedupeChildList(base.children, seen)
  if (nextChildren === undefined) {
    return base
  }
  if (base === node) {
    return { ...node, children: nextChildren }
  }
  base.children = nextChildren
  return base
}

/** Clones any reused vnode in the tree so snabbdom never sees one object at two
 *  positions. Memoized subtrees (createLazy/createKeyedLazy results) are left
 *  opaque so their same-vnode short-circuit survives. Pass a shared `seen` set
 *  to coordinate with `dedupeMemoizedResult` across a render; omit it for
 *  one-off use. */
export const dedupeSharedVNodes = (
  root: VNode,
  seen: Set<object> = new Set(),
): VNode => visit(root, seen)

/** Dedupes the freshly built subtree of a memoized view (a
 *  createLazy/createKeyedLazy result) so a const shared inside it, or across
 *  memoized siblings sharing `seen`, is cloned even though the top-level pass
 *  leaves memoized subtrees opaque. A root owned by an earlier tree or lazy slot
 *  is cloned before this slot caches it. The result root stays untracked so the
 *  top-level pass exempts it rather than treating it as a duplicate. */
export const dedupeMemoizedResult = (
  root: VNode,
  seen: Set<object> = new Set(),
): VNode => {
  const base: VNode =
    seen.has(root) || root.elm != null || memoizedVNodes.has(root)
      ? { ...root, elm: undefined }
      : root

  if (base.children === undefined) {
    return base
  }

  const nextChildren = dedupeChildList(base.children, seen)

  if (nextChildren === undefined) {
    return base
  }

  if (base === root) {
    return { ...root, children: nextChildren }
  }

  base.children = nextChildren
  return base
}

/** The patch operations a runtime uses, bound to one Platform. Every node
 *  operation, including mounting over and recovering the container, goes
 *  through the Platform's `domApi`. */
export type Vdom = Readonly<{
  patchVNode: (
    maybeCurrentVNode: Option.Option<VNode>,
    nextVNode: VNode | null,
    container: HTMLElement,
    seen?: Set<object>,
    onRootPatched?: (vnode: VNode) => void,
  ) => VNode
  recoverVNodeAfterPatchFailure: (currentVNode: VNode) => VNode
}>

export const makeVdom = (platform: Platform): Vdom => {
  const { domApi } = platform
  const platformPatch =
    platform === browserPlatform ? patch : makePatch(platform)

  // NOTE: a fresh boot builds the whole tree so snabbdom fires every insert
  // hook, which is what runs Mounts. Patching `toVNode(container)` directly
  // would let snabbdom reuse a container whose existing DOM happens to match
  // the new tree (a fresh `run` over server-rendered DOM, or a
  // Model-preservation restore), leaving those hooks unfired and Mounts
  // unattached.
  // Patching against a comment placed where the container was is never
  // `sameVnode` with an element, so `createElm` builds the tree fresh and
  // replaces the container, exactly as a boot into an empty container does.
  const patchFreshInto = (
    container: HTMLElement,
    nextVNode: VNode,
    onRootPatched?: (vnode: VNode) => void,
  ): VNode => {
    const parent = domApi.parentNode(container)
    if (parent === null) {
      return platformPatch(toVNode(container, domApi), nextVNode, onRootPatched)
    }
    const placeholder = domApi.createComment('')
    domApi.insertBefore(parent, placeholder, container)
    domApi.removeChild(parent, container)
    return platformPatch(toVNode(placeholder, domApi), nextVNode, onRootPatched)
  }

  const patchVNode: Vdom['patchVNode'] = (
    maybeCurrentVNode,
    nextVNode,
    container,
    seen,
    onRootPatched,
  ) => {
    const dedupedVNode =
      nextVNode !== null ? dedupeSharedVNodes(nextVNode, seen) : h('!')

    if (Option.isNone(maybeCurrentVNode)) {
      return patchFreshInto(container, dedupedVNode, onRootPatched)
    }

    return platformPatch(maybeCurrentVNode.value, dedupedVNode, onRootPatched)
  }

  const recoverVNodeAfterPatchFailure = (currentVNode: VNode): VNode => {
    const currentElement = currentVNode.elm
    const recoveryVNode = platformPatch(currentVNode, h('!'))

    if (recoveryVNode.elm !== currentElement && currentElement !== undefined) {
      const parent = domApi.parentNode(currentElement)
      if (parent !== null) {
        domApi.removeChild(parent, currentElement)
      }
    }

    return recoveryVNode
  }

  return { patchVNode, recoverVNodeAfterPatchFailure }
}

const browserVdom = makeVdom(browserPlatform)

export const __patchVNode = browserVdom.patchVNode

export const __recoverVNodeAfterPatchFailure =
  browserVdom.recoverVNodeAfterPatchFailure
